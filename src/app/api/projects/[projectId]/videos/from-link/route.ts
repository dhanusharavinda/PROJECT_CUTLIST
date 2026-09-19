import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, now, one, run } from "@/lib/db";
import { assert, badRequest, can, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { fetchLink, LinkFetchUnavailable, ytdlpPath } from "@/lib/media/fetch";
import { startAnalysis } from "@/lib/analysis/analyze";
import type { Video } from "@/lib/types";

type Params = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Whether this machine can fetch a reel by link at all. */
export const GET = route(async () => {
  await requireCtx();
  return json({ available: Boolean(ytdlpPath()) });
});

const FromLink = z.object({
  url: z.string().trim().url(),
  /** A reference reel to study, or footage to cut. */
  role: z.enum(["reference", "footage"]).default("reference"),
  title: z.string().trim().max(200).optional(),
});

/**
 * Paste a reel link. The file lands on disk, the analyser reads it, and as a
 * reference it can be turned into a template.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot add footage.");

  const input = FromLink.parse(await body(req));

  let fetched;
  try {
    fetched = await fetchLink(ctx.workspace.id, input.url);
  } catch (err) {
    if (err instanceof LinkFetchUnavailable) throw badRequest(err.message);
    throw err;
  }

  const position =
    one<{ n: number }>(
      "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM videos WHERE project_id = ? AND workspace_id = ?",
      projectId,
      ctx.workspace.id,
    )?.n ?? 0;

  const videoId = id("vid");
  run(
    `INSERT INTO videos
       (id, workspace_id, project_id, title, source, storage_key, external_url, drive_file_id,
        mime, size_bytes, duration_ms, status, position, created_by, created_at,
        source_name, share_url, role, local_state)
     VALUES (?,?,?,?,'link',?,?,NULL,'video/mp4',?,0,'ready',?,?,?,?,?,?,'ready')`,
    videoId,
    ctx.workspace.id,
    projectId,
    input.title || fetched.title,
    fetched.key,
    input.url,
    fetched.size,
    position,
    ctx.user.id,
    now(),
    `${fetched.platform}: ${fetched.title}`.slice(0, 300),
    input.url,
    input.role,
  );

  const video = one<Video>("SELECT * FROM videos WHERE id = ? AND workspace_id = ?", videoId, ctx.workspace.id)!;

  try {
    startAnalysis(ctx, video);
  } catch {
    /* no ffmpeg: the clip still plays, it just cannot be measured */
  }

  emit(
    ctx.workspace.id,
    { type: "video", projectId, payload: video },
    {
      actorId: ctx.user.id,
      verb: "video.fetched",
      summary: `${fetched.platform} reel fetched into ${project.name} as ${input.role}`,
    },
  );

  return json({ video });
});
