import { json, route } from "@/lib/api";
import { id, now, one, run } from "@/lib/db";
import { assert, badRequest, can, getProject, requireCtx } from "@/lib/tenancy";
import { buildKey, maxUploadBytes, removeKey, writeStream } from "@/lib/storage";
import { emit } from "@/lib/activity";

type Params = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
// Large files stream to disk; nothing here should be cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Raw-body upload: the browser PUTs the File directly, so there is no multipart
 * parse and no full-file buffer in memory. Metadata rides on the query string.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot upload footage.");

  const url = new URL(req.url);
  const filename = (url.searchParams.get("filename") || "clip.mp4").slice(0, 200);
  const mime = url.searchParams.get("mime") || "video/mp4";
  const durationMs = Number(url.searchParams.get("duration") || 0);

  if (!mime.startsWith("video/") && !mime.startsWith("audio/")) {
    throw badRequest("Only video or audio files can be uploaded here.");
  }
  if (!req.body) throw badRequest("No file data was received.");

  const key = buildKey(ctx.workspace.id, "video", filename);
  let size = 0;
  try {
    size = await writeStream(key, req.body, maxUploadBytes());
  } catch (err) {
    throw badRequest((err as Error).message);
  }
  if (size === 0) {
    await removeKey(key);
    throw badRequest("The uploaded file was empty.");
  }

  const nextPosition =
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
        source_name, local_state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ready')`,
    videoId,
    ctx.workspace.id,
    projectId,
    filename.replace(/\.[a-z0-9]{2,5}$/i, "") || filename,
    "upload",
    key,
    null,
    null,
    mime,
    size,
    Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
    "ready",
    nextPosition,
    ctx.user.id,
    now(),
    filename,
  );

  run(
    "UPDATE projects SET updated_at = ? WHERE id = ? AND workspace_id = ?",
    now(),
    projectId,
    ctx.workspace.id,
  );

  const video = one(
    "SELECT * FROM videos WHERE id = ? AND workspace_id = ?",
    videoId,
    ctx.workspace.id,
  );

  emit(
    ctx.workspace.id,
    { type: "video", projectId, payload: video },
    {
      actorId: ctx.user.id,
      verb: "video.uploaded",
      summary: `${filename} uploaded to ${project.name}`,
    },
  );

  return json({ video });
});
