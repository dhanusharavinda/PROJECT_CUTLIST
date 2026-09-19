import { emit } from "../activity";
import { noEmDash } from "../format";
import { resolveKey } from "../storage";
import type { Ctx } from "../tenancy";
import type { Video } from "../types";
import { resolveStt, transcribe } from "../ai/stt";
import { analyzeAudio } from "./audio";
import { ffError, requireFfmpeg, runFf } from "./ffmpeg";
import { probe } from "./probe";
import {
  failAnalysis,
  finishAnalysis,
  markRunning,
  replaceFrames,
  setTags,
} from "./store";
import type { AnalysisPayload, ClipSpeech, Orientation, Shot } from "./types";
import { sampleFrame, sceneScan, shotsFrom } from "./video";
import { intelligence } from "./intel";

/**
 * One clip, understood end to end: what it looks like, how it is cut, what the
 * soundtrack is doing and what is said in it. Local, free and no key required.
 */

export const ENGINE_VERSION = "local-1";

/** Thumbnails kept per clip. Also the ceiling on frames sent to a model. */
const MAX_FRAMES = 18;
/** Shots we bother measuring colour on. Beyond this the look is interpolated. */
const MAX_SAMPLED_SHOTS = 40;
const MAX_SPEECH_MS = 12 * 60 * 1000;

export class NotAnalysable extends Error {}

/** ffmpeg needs a real file or a plain URL; a Drive clip is neither. */
export function sourceFor(video: Video): string {
  if (video.storage_key) return resolveKey(video.storage_key);
  if (video.source === "link" && video.external_url) return video.external_url;
  throw new NotAnalysable(
    video.source === "drive"
      ? "Drive clips stream through your Google account, so the analyser cannot open them. Download the file and upload it to analyse this clip."
      : "This clip has no file behind it.",
  );
}

function orientationOf(width: number, height: number): Orientation {
  if (!width || !height) return "landscape";
  const ratio = width / height;
  if (ratio < 0.95) return "portrait";
  if (ratio > 1.05) return "landscape";
  return "square";
}

async function speechFor(
  workspaceId: string,
  source: string,
  ffmpegBin: string,
  durationMs: number,
): Promise<ClipSpeech | null> {
  if (!resolveStt(workspaceId)) return null;
  if (durationMs > MAX_SPEECH_MS) return null;

  const encoded = await runFf(
    ffmpegBin,
    [
      "-hide_banner",
      "-nostdin",
      "-v",
      "error",
      "-i",
      source,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      "-f",
      "mp3",
      "-",
    ],
    { timeoutMs: 180_000, maxStdout: 48 * 1024 * 1024 },
  );
  if (encoded.code !== 0 || encoded.stdout.length < 2000) return null;

  const result = await transcribe(
    workspaceId,
    encoded.stdout,
    "clip.mp3",
    "audio/mpeg",
  );

  return {
    text: noEmDash(result.text),
    provider: `${result.provider}:${result.model}`,
    segments: result.segments.map((s) => ({
      start_ms: s.start_ms,
      end_ms: s.end_ms,
    })),
    lines: result.segments.slice(0, 200).map((s) => ({
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      text: noEmDash(s.text),
    })),
  };
}

/** Plain-language tags, derived from the numbers. The clip library runs on these. */
export function localTags(payload: AnalysisPayload): string[] {
  const tags: string[] = [];
  const shots = payload.shots;
  const durationSec = payload.duration_ms / 1000;

  tags.push(
    payload.orientation === "portrait"
      ? "9:16"
      : payload.orientation === "square"
        ? "square"
        : "16:9",
  );

  if (durationSec <= 15) tags.push("under-15s");
  else if (durationSec <= 60) tags.push("15-60s");
  else tags.push("over-60s");

  if (!payload.has_audio) tags.push("no-audio");
  else if (payload.bpm > 0) tags.push("music");
  if (payload.speech.length > 0) {
    const talking = payload.speech.reduce((a, r) => a + (r.end_ms - r.start_ms), 0);
    if (talking > payload.duration_ms * 0.35) tags.push("talking");
  }
  if (payload.has_audio && payload.loudness_db < -35) tags.push("quiet");

  if (shots.length > 0) {
    const motion = shots.reduce((a, s) => a + s.motion, 0) / shots.length;
    if (motion < 0.02) tags.push("static");
    else if (motion > 0.1) tags.push("high-motion");
    else tags.push("steady");

    const brightness = shots.reduce((a, s) => a + s.brightness, 0) / shots.length;
    if (brightness < 0.3) tags.push("dark");
    else if (brightness > 0.62) tags.push("bright");

    const coloured = shots.filter((s) => s.saturation > 0.12);
    if (coloured.length) {
      const warm = coloured.filter((s) => s.hue < 70 || s.hue > 320).length;
      const cool = coloured.filter((s) => s.hue >= 170 && s.hue <= 260).length;
      if (warm > coloured.length * 0.6) tags.push("warm");
      else if (cool > coloured.length * 0.6) tags.push("cool");
      if (
        warm > coloured.length * 0.6 &&
        brightness > 0.35 &&
        brightness < 0.7
      )
        tags.push("golden-hour");
    }

    if (shots.some((s) => s.stable)) tags.push("locked-off");
    if (shots.length <= 1) tags.push("one-shot");
    else if (durationSec > 0 && shots.length / (durationSec / 60) > 30)
      tags.push("many-cuts");
  }

  return tags;
}

/** The whole pass. Throws only when the clip cannot be opened at all. */
export async function runAnalysis(ctx: Ctx, video: Video): Promise<void> {
  const { ffmpeg, ffprobe } = requireFfmpeg();
  const source = sourceFor(video);

  const meta = await probe(source, ffprobe);
  const durationMs = meta.duration_ms || video.duration_ms || 0;
  if (durationMs <= 0) {
    throw new NotAnalysable("This file has no readable duration.");
  }

  // An audio-only file (a voice memo, a music bed) still analyses: it just has
  // one "shot" and all of its value is in the soundtrack.
  const hasVideo = meta.width > 0 && meta.height > 0;
  const samples = hasVideo ? await sceneScan(source, ffmpeg) : [];
  const raw = hasVideo
    ? shotsFrom(samples, durationMs)
    : [{ start_ms: 0, end_ms: durationMs, motion: 0, motion_peak: 0, stable: false }];

  // Colour is measured on a spread of shots; thumbnails on a subset of those.
  const shotStep = Math.max(1, Math.ceil(raw.length / MAX_SAMPLED_SHOTS));
  const frameStep = Math.max(1, Math.ceil(raw.length / MAX_FRAMES));

  const frames: {
    idx: number;
    at_ms: number;
    storage_key: string;
    shot_idx: number;
  }[] = [];
  const shots: Shot[] = [];
  let lastLook = { brightness: 0, saturation: 0, hue: 0, palette: [] as string[] };

  for (let i = 0; i < raw.length && hasVideo; i++) {
    const shot = raw[i];
    const held = shot.end_ms - shot.start_ms;
    const at = Math.max(
      0,
      Math.min(durationMs - 60, shot.start_ms + Math.min(400, held / 2)),
    );

    const wantsFrame = i % frameStep === 0 && frames.length < MAX_FRAMES;
    const wantsLook = wantsFrame || i % shotStep === 0;

    let frameIdx: number | null = null;
    if (wantsLook) {
      const key = wantsFrame
        ? `${ctx.workspace.id}/analysis/${video.id}/${frames.length}.jpg`
        : null;
      const look = await sampleFrame(
        source,
        ffmpeg,
        at,
        key ? resolveKey(key) : null,
      );
      if (look) lastLook = look;
      if (wantsFrame && key && look) {
        frameIdx = frames.length;
        frames.push({
          idx: frames.length,
          at_ms: Math.round(at),
          storage_key: key,
          shot_idx: i,
        });
      }
    }

    shots.push({
      idx: i,
      start_ms: shot.start_ms,
      end_ms: shot.end_ms,
      motion: shot.motion,
      motion_peak: shot.motion_peak,
      brightness: lastLook.brightness,
      saturation: lastLook.saturation,
      hue: lastLook.hue,
      palette: lastLook.palette,
      stable: shot.stable,
      frame_idx: frameIdx,
    });
  }

  const audio = meta.has_audio
    ? await analyzeAudio(source, ffmpeg, durationMs).catch(() => null)
    : null;

  let speech: ClipSpeech | null = null;
  if (meta.has_audio) {
    try {
      speech = await speechFor(ctx.workspace.id, source, ffmpeg, durationMs);
    } catch {
      // A missing or rejected STT key must not lose the rest of the analysis.
      speech = null;
    }
  }

  // With no picture there are no sampled shots, so keep the single raw one.
  if (!hasVideo) {
    for (const shot of raw) {
      shots.push({
        idx: 0,
        start_ms: shot.start_ms,
        end_ms: shot.end_ms,
        motion: 0,
        motion_peak: 0,
        brightness: 0,
        saturation: 0,
        hue: 0,
        palette: [],
        stable: false,
        frame_idx: null,
      });
    }
  }

  const orientation = orientationOf(meta.width, meta.height);
  const warnings: string[] = [];
  if (!hasVideo) warnings.push("This file has no video track, only audio.");
  if (orientation !== "portrait")
    warnings.push(
      `Shot ${orientation === "square" ? "square" : "landscape"} at ${meta.width}x${meta.height}. Reels are 9:16.`,
    );
  if (!meta.has_audio) warnings.push("No audio track, so there is nothing to cut to.");
  if (meta.height && meta.height < 720)
    warnings.push(`Only ${meta.height}p. Instagram compresses hard; 1080p or better holds up.`);
  if (audio && audio.bpm === 0 && audio.beat_confidence < 0.35 && meta.has_audio)
    warnings.push("No steady tempo found, so beat-matched cuts are not available for this clip.");

  // Camera movement, opener score, repeats, weak stretches and B-roll
  // candidates: all arithmetic over what was just measured, so it is free.
  const shotsWithIntel = intelligence(shots, audio?.speech ?? []);

  const payload: AnalysisPayload = {
    version: 2,
    orientation,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    duration_ms: durationMs,
    has_audio: meta.has_audio,
    shots: shotsWithIntel,
    beats: audio?.beats ?? [],
    bpm: audio?.bpm ?? 0,
    beat_confidence: audio?.beat_confidence ?? 0,
    drops: audio?.drops ?? [],
    energy: audio?.energy ?? [],
    silences: audio?.silences ?? [],
    speech: audio?.speech ?? [],
    loudness_db: audio?.loudness_db ?? -70,
    frames: frames.map((f) => ({ idx: f.idx, at_ms: f.at_ms })),
    speech_text: speech,
    warnings,
  };

  await replaceFrames(ctx, video.id, frames);

  finishAnalysis(ctx, video.id, {
    engine: ENGINE_VERSION,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    durationMs,
    hasAudio: meta.has_audio,
    bpm: payload.bpm,
    sceneCount: shots.length,
    payload,
  });

  setTags(
    ctx,
    video.id,
    "local",
    localTags(payload).map((tag) => ({ tag })),
  );

  emit(
    ctx.workspace.id,
    { type: "video", projectId: video.project_id, payload: { id: video.id } },
    {
      actorId: ctx.user.id,
      verb: "clip.analysed",
      summary: `${video.title} analysed: ${shots.length} shot${shots.length === 1 ? "" : "s"}${payload.bpm ? `, ${Math.round(payload.bpm)} BPM` : ""}`,
    },
  );
}

// One pass per clip at a time, however many times the button is pressed.
const globalForJobs = globalThis as unknown as { __cutlistAnalysis?: Set<string> };
const running: Set<string> = globalForJobs.__cutlistAnalysis ?? new Set<string>();
globalForJobs.__cutlistAnalysis = running;

export function isAnalysing(videoId: string): boolean {
  return running.has(videoId);
}

/**
 * Start the pass and return immediately. ffmpeg on a long clip outlives any
 * sensible request, so the row carries the status and the UI polls it.
 */
export function startAnalysis(ctx: Ctx, video: Video): { started: boolean } {
  if (running.has(video.id)) return { started: false };

  // Fails fast, before a row claims to be running.
  requireFfmpeg();
  sourceFor(video);

  running.add(video.id);
  markRunning(ctx, video);

  void runAnalysis(ctx, video)
    .catch((err: Error) => {
      console.error("[analysis]", video.id, err);
      failAnalysis(ctx, video.id, err.message || "Analysis failed.");
      emit(ctx.workspace.id, {
        type: "video",
        projectId: video.project_id,
        payload: { id: video.id },
      });
    })
    .finally(() => {
      running.delete(video.id);
    });

  return { started: true };
}
