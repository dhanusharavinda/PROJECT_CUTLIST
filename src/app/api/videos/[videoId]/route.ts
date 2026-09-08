import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { now, one, run } from "@/lib/db";
import { assert, can, getVideo, requireCtx } from "@/lib/tenancy";
import { removeKey } from "@/lib/storage";
import { emit } from "@/lib/activity";

type Params = { params: Promise<{ videoId: string }> };

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  position: z.number().int().nonnegative().optional(),
});

export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot change footage.");

  const input = Patch.parse(await body(req));

  run(
    `UPDATE videos
        SET title = COALESCE(?, title),
            duration_ms = COALESCE(?, duration_ms),
            position = COALESCE(?, position)
      WHERE id = ? AND workspace_id = ?`,
    input.title ?? null,
    input.durationMs ?? null,
    input.position ?? null,
    videoId,
    ctx.workspace.id,
  );

  const updated = one(
    "SELECT * FROM videos WHERE id = ? AND workspace_id = ?",
    videoId,
    ctx.workspace.id,
  );

  // Duration arrives from the browser on first play — not worth broadcasting.
  if (input.title || input.position !== undefined) {
    emit(ctx.workspace.id, {
      type: "video",
      projectId: video.project_id,
      payload: updated,
    });
  }

  return json({ video: updated });
});

export const DELETE = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot remove footage.");

  run(
    "DELETE FROM videos WHERE id = ? AND workspace_id = ?",
    videoId,
    ctx.workspace.id,
  );

  // Rows cascade; the file on disk does not.
  if (video.storage_key) {
    await removeKey(video.storage_key).catch(() => {});
  }

  run(
    "UPDATE projects SET updated_at = ? WHERE id = ? AND workspace_id = ?",
    now(),
    video.project_id,
    ctx.workspace.id,
  );

  emit(
    ctx.workspace.id,
    { type: "video", projectId: video.project_id, payload: { deleted: videoId } },
    {
      actorId: ctx.user.id,
      verb: "video.removed",
      summary: `${video.title} removed`,
    },
  );

  return json({ ok: true });
});
