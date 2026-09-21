import fs from "node:fs";
import path from "node:path";
import { emit } from "../activity";
import { one, run } from "../db";
import { buildKey, removeKey, resolveKey, writeStream } from "../storage";
import type { Ctx } from "../tenancy";
import type { Video } from "../types";
import { startAnalysis } from "../analysis/analyze";
import { ffError, ffmpegPath, ffprobePath, runFf } from "../analysis/ffmpeg";
import { probe } from "../analysis/probe";
import { providerFor } from "./provider";

/**
 * Drive owns the footage. This module makes the app's own working copy.
 *
 * Without a local file nothing else works: the analyser cannot open a Drive
 * clip, scrubbing costs a Google round trip per seek, and an iPhone HEVC file
 * will not decode in a browser at all. So attaching a clip queues a copy, and
 * the copy is a derived cache the app owns, can rebuild, and can throw away.
 * The original in Drive is never touched.
 */

/** Codecs a browser will decode. Anything else earns a preview copy. */
const BROWSER_SAFE = new Set(["h264", "avc1", "vp8", "vp9", "av1", "theora", "mpeg4"]);

/** One clip at a time: a copy plus a decode pass is not something to run eight of. */
export type ImportStage = "queued" | "copying" | "preview" | "reading";

export interface ImportProgress {
  stage: ImportStage;
  copied: number;
  total: number;
}

export function importMaxBytes(): number {
  const mb = Number(process.env.IMPORT_MAX_MB || 4096);
  return (Number.isFinite(mb) && mb > 0 ? mb : 4096) * 1024 * 1024;
}

interface Job {
  ctx: Ctx;
  videoId: string;
}

const globalForImports = globalThis as unknown as {
  __cutlistImports?: {
    progress: Map<string, ImportProgress>;
    queue: Job[];
    running: boolean;
  };
};

const jobs =
  globalForImports.__cutlistImports ??
  ({ progress: new Map<string, ImportProgress>(), queue: [], running: false } as {
    progress: Map<string, ImportProgress>;
    queue: Job[];
    running: boolean;
  });
globalForImports.__cutlistImports = jobs;

export function importProgress(videoId: string): ImportProgress | null {
  return jobs.progress.get(videoId) ?? null;
}

export function isImporting(videoId: string): boolean {
  return jobs.progress.has(videoId);
}

function setStage(videoId: string, stage: ImportStage, copied = 0, total = 0) {
  const existing = jobs.progress.get(videoId);
  jobs.progress.set(videoId, {
    stage,
    copied: copied || existing?.copied || 0,
    total: total || existing?.total || 0,
  });
}

function videoRow(ctx: Ctx, videoId: string): Video | null {
  return one<Video>(
    "SELECT * FROM videos WHERE id = ? AND workspace_id = ?",
    videoId,
    ctx.workspace.id,
  );
}

function markFailed(ctx: Ctx, videoId: string, message: string) {
  run(
    "UPDATE videos SET local_state = 'failed', local_error = ? WHERE id = ? AND workspace_id = ?",
    message.slice(0, 400),
    videoId,
    ctx.workspace.id,
  );
}

/** Counts bytes on the way past, so the card can show a percentage. */
function counted(
  stream: ReadableStream<Uint8Array>,
  onBytes: (total: number) => void,
): ReadableStream<Uint8Array> {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        onBytes(total);
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * A browser-playable copy, made only when the original will not decode.
 * Fits inside 1280x1280, so a 1080x1920 phone clip becomes 720x1280.
 * ffmpeg autorotates on decode, so the preview comes out upright.
 */
async function buildProxy(
  ctx: Ctx,
  video: Video,
  sourcePath: string,
): Promise<string | null> {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) return null;

  const key = `${ctx.workspace.id}/proxy/${video.id}.mp4`;
  const out = resolveKey(key);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const result = await runFf(
    ffmpeg,
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-v",
      "error",
      "-i",
      sourcePath,
      "-vf",
      "scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      out,
    ],
    // An output path, never stdout: runFf buffers stdout and would kill a
    // multi-hundred-megabyte encode at its cap.
    { timeoutMs: 900_000, maxStdout: 4096 },
  );

  if (result.code !== 0) throw new Error(`Preview copy failed: ${ffError(result)}`);
  return key;
}

async function localizeOne(ctx: Ctx, videoId: string): Promise<void> {
  let video = videoRow(ctx, videoId);
  if (!video) return;

  // ── The copy ──────────────────────────────────────────────────────────────
  if (!video.storage_key) {
    // The provider that holds the original brings it here. Drive today; a
    // Dropbox or S3 provider would slot in without this file changing.
    const provider = providerFor(video);
    if (!provider.fetchToLocal) {
      throw new Error(`${provider.label} clips cannot be copied locally.`);
    }

    setStage(videoId, "copying", 0, video.size_bytes);
    const fetched = await provider.fetchToLocal(ctx, video, {
      maxBytes: importMaxBytes(),
      onBytes: (copied, total) => setStage(videoId, "copying", copied, total),
    });
    const key = fetched.key;

    run(
      `UPDATE videos
          SET storage_key = ?, size_bytes = ?, local_state = 'ready', local_error = NULL,
              source_name = CASE WHEN source_name = '' THEN ? ELSE source_name END
        WHERE id = ? AND workspace_id = ?`,
      key,
      fetched.size,
      fetched.name,
      videoId,
      ctx.workspace.id,
    );
    emit(ctx.workspace.id, {
      type: "video",
      projectId: video.project_id,
      payload: { id: videoId },
    });
    video = videoRow(ctx, videoId);
    if (!video) return;
  } else {
    run(
      "UPDATE videos SET local_state = 'ready', local_error = NULL WHERE id = ? AND workspace_id = ?",
      videoId,
      ctx.workspace.id,
    );
  }

  const source = resolveKey(video.storage_key!);

  // ── What it actually is ───────────────────────────────────────────────────
  const ffprobe = ffprobePath();
  if (ffprobe) {
    const meta = await probe(source, ffprobe).catch(() => null);
    if (meta) {
      run(
        `UPDATE videos
            SET codec = ?, fps = ?,
                duration_ms = CASE WHEN ? > 0 THEN ? ELSE duration_ms END
          WHERE id = ? AND workspace_id = ?`,
        meta.video_codec,
        meta.fps,
        meta.duration_ms,
        meta.duration_ms,
        videoId,
        ctx.workspace.id,
      );

      // ── The preview copy, only when the browser cannot decode the original ──
      if (meta.video_codec && !BROWSER_SAFE.has(meta.video_codec.toLowerCase())) {
        setStage(videoId, "preview");
        const proxyKey = await buildProxy(ctx, video, source);
        if (proxyKey) {
          run(
            "UPDATE videos SET proxy_key = ? WHERE id = ? AND workspace_id = ?",
            proxyKey,
            videoId,
            ctx.workspace.id,
          );
        }
      }
    }
  }

  // ── What is in it ─────────────────────────────────────────────────────────
  setStage(videoId, "reading");
  const fresh = videoRow(ctx, videoId);
  if (fresh) {
    try {
      startAnalysis(ctx, fresh);
    } catch {
      // No ffmpeg, or nothing to open. The copy is still worth having.
    }
  }

  emit(
    ctx.workspace.id,
    { type: "video", projectId: video.project_id, payload: { id: videoId } },
    {
      actorId: ctx.user.id,
      verb: "clip.localised",
      summary: `${video.title} copied from Drive`,
    },
  );
}

async function pump() {
  if (jobs.running) return;
  jobs.running = true;
  try {
    while (jobs.queue.length > 0) {
      const job = jobs.queue.shift()!;
      try {
        await localizeOne(job.ctx, job.videoId);
      } catch (err) {
        console.error("[localize]", job.videoId, err);
        markFailed(job.ctx, job.videoId, (err as Error).message || "Copy failed.");
        emit(job.ctx.workspace.id, {
          type: "video",
          projectId: videoRow(job.ctx, job.videoId)?.project_id ?? "",
          payload: { id: job.videoId },
        });
      } finally {
        jobs.progress.delete(job.videoId);
      }
    }
  } finally {
    jobs.running = false;
  }
}

/**
 * Queue a clip for a local copy. Returns immediately: the row carries the state
 * and the footage panel polls it.
 */
export function enqueueLocalize(ctx: Ctx, video: Video): { queued: boolean } {
  if (jobs.progress.has(video.id)) return { queued: false };
  if (video.source !== "drive" && !video.storage_key) return { queued: false };

  setStage(video.id, "queued", 0, video.size_bytes);
  run(
    "UPDATE videos SET local_state = 'copying', local_error = NULL WHERE id = ? AND workspace_id = ?",
    video.id,
    ctx.workspace.id,
  );
  jobs.queue.push({ ctx, videoId: video.id });
  void pump();
  return { queued: true };
}

/** Drop the working copy and the preview, keeping the rows and the stills. */
export async function releaseLocal(ctx: Ctx, video: Video): Promise<void> {
  if (video.source !== "drive") {
    throw new Error(
      "This clip only exists here, so releasing the copy would lose the footage.",
    );
  }

  const keys = [video.storage_key, video.proxy_key].filter(Boolean) as string[];
  run(
    `UPDATE videos SET storage_key = NULL, proxy_key = NULL, local_state = 'none'
      WHERE id = ? AND workspace_id = ?`,
    video.id,
    ctx.workspace.id,
  );
  await Promise.all(keys.map((key) => removeKey(key).catch(() => undefined)));

  emit(ctx.workspace.id, {
    type: "video",
    projectId: video.project_id,
    payload: { id: video.id },
  });
}

