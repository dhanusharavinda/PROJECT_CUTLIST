import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, now, one, run } from "@/lib/db";
import { assert, badRequest, can, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { listVideos } from "@/lib/queries";

type Params = { params: Promise<{ projectId: string }> };

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  return json({ videos: listVideos(ctx, projectId) });
});

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  source: z.enum(["drive", "link"]),
  externalUrl: z.string().trim().url().optional(),
  driveFileId: z.string().trim().optional(),
  mime: z.string().trim().max(100).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

/** Attach footage that lives elsewhere — a Drive file or a direct URL. */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot attach footage.");

  const input = Create.parse(await body(req));
  if (input.source === "drive" && !input.driveFileId)
    throw badRequest("A Drive file id is required.");
  if (input.source === "link" && !input.externalUrl)
    throw badRequest("A URL is required.");

  const nextPosition =
    (one<{ n: number }>(
      "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM videos WHERE project_id = ? AND workspace_id = ?",
      projectId,
      ctx.workspace.id,
    )?.n ?? 0) | 0;

  const videoId = id("vid");
  run(
    `INSERT INTO videos
       (id, workspace_id, project_id, title, source, storage_key, external_url, drive_file_id,
        mime, size_bytes, duration_ms, status, position, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    videoId,
    ctx.workspace.id,
    projectId,
    input.title,
    input.source,
    null,
    input.externalUrl ?? null,
    input.driveFileId ?? null,
    input.mime ?? "video/mp4",
    input.sizeBytes ?? 0,
    input.durationMs ?? 0,
    "ready",
    nextPosition,
    ctx.user.id,
    now(),
  );

  run(
    "UPDATE projects SET updated_at = ? WHERE id = ? AND workspace_id = ?",
    now(),
    projectId,
    ctx.workspace.id,
  );

  const video = one("SELECT * FROM videos WHERE id = ? AND workspace_id = ?", videoId, ctx.workspace.id);

  emit(
    ctx.workspace.id,
    { type: "video", projectId, payload: video },
    {
      actorId: ctx.user.id,
      verb: "video.added",
      summary: `${input.title} attached to ${project.name}`,
    },
  );

  return json({ video });
});
