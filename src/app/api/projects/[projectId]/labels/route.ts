import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, now, one, run } from "@/lib/db";
import { assert, badRequest, can, getProject, getVideo, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { listLabels } from "@/lib/queries";
import { LABEL_TYPES } from "@/lib/types";

type Params = { params: Promise<{ projectId: string }> };

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  return json({ labels: listLabels(ctx, projectId) });
});

const Create = z.object({
  videoId: z.string().nullable().optional(),
  type: z.enum(LABEL_TYPES),
  title: z.string().trim().min(1, "Give the instruction a title.").max(200),
  detail: z.string().trim().max(2000).optional(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
});

export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  assert(can.createLabel(ctx.role), "Viewers cannot add instructions.");

  const input = Create.parse(await body(req));

  if (input.videoId) {
    const video = getVideo(ctx, input.videoId);
    if (video.project_id !== projectId)
      throw badRequest("That clip belongs to a different project.");
  }

  const labelId = id("lab");
  run(
    `INSERT INTO labels
       (id, workspace_id, project_id, video_id, note_id, type, title, detail,
        start_ms, end_ms, priority, status, confidence, origin, assignee_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    labelId,
    ctx.workspace.id,
    projectId,
    input.videoId ?? null,
    null,
    input.type,
    input.title,
    input.detail ?? "",
    input.startMs,
    input.endMs ?? null,
    input.priority,
    "open",
    1,
    "manual",
    null,
    now(),
    now(),
  );

  run(
    "UPDATE projects SET updated_at = ? WHERE id = ? AND workspace_id = ?",
    now(),
    projectId,
    ctx.workspace.id,
  );

  const label = one(
    "SELECT * FROM labels WHERE id = ? AND workspace_id = ?",
    labelId,
    ctx.workspace.id,
  );

  emit(
    ctx.workspace.id,
    { type: "label", projectId, payload: { label } },
    {
      actorId: ctx.user.id,
      verb: "label.created",
      summary: `${ctx.user.name} added "${input.title}"`,
    },
  );

  return json({ label });
});
