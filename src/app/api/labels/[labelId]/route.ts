import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { now, one, run } from "@/lib/db";
import { assert, badRequest, can, getLabel, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { LABEL_TYPES, type Label } from "@/lib/types";
import { many } from "@/lib/db";

type Params = { params: Promise<{ labelId: string }> };

const Patch = z.object({
  type: z.enum(LABEL_TYPES).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().max(2000).optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  status: z.enum(["open", "doing", "done", "skipped"]).optional(),
  assigneeId: z.string().nullable().optional(),
});

export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { labelId } = await params;
  const label = getLabel(ctx, labelId);
  assert(can.updateLabelStatus(ctx.role), "Viewers cannot change instructions.");

  const input = Patch.parse(await body(req));

  if (input.assigneeId) {
    const member = one(
      "SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ?",
      ctx.workspace.id,
      input.assigneeId,
    );
    if (!member) throw badRequest("That person is not in this workspace.");
  }

  run(
    `UPDATE labels SET
        type = COALESCE(?, type),
        title = COALESCE(?, title),
        detail = COALESCE(?, detail),
        start_ms = COALESCE(?, start_ms),
        end_ms = CASE WHEN ? THEN ? ELSE end_ms END,
        priority = COALESCE(?, priority),
        status = COALESCE(?, status),
        assignee_id = CASE WHEN ? THEN ? ELSE assignee_id END,
        updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
    input.type ?? null,
    input.title ?? null,
    input.detail ?? null,
    input.startMs ?? null,
    input.endMs !== undefined ? 1 : 0,
    input.endMs ?? null,
    input.priority ?? null,
    input.status ?? null,
    input.assigneeId !== undefined ? 1 : 0,
    input.assigneeId ?? null,
    now(),
    labelId,
    ctx.workspace.id,
  );

  const updated = one<Label>(
    "SELECT * FROM labels WHERE id = ? AND workspace_id = ?",
    labelId,
    ctx.workspace.id,
  );

  // A cut list that has just been finished is worth putting in the feed.
  if (input.status === "done" && label.status !== "done") {
    const remaining = many<{ n: number }>(
      "SELECT COUNT(*) AS n FROM labels WHERE project_id = ? AND workspace_id = ? AND status IN ('open','doing')",
      label.project_id,
      ctx.workspace.id,
    )[0]?.n;
    emit(
      ctx.workspace.id,
      { type: "label", projectId: label.project_id, payload: { label: updated } },
      remaining === 0
        ? {
            actorId: ctx.user.id,
            verb: "labels.cleared",
            summary: `${ctx.user.name} cleared the cut list`,
          }
        : undefined,
    );
  } else {
    emit(ctx.workspace.id, {
      type: "label",
      projectId: label.project_id,
      payload: { label: updated },
    });
  }

  return json({ label: updated });
});

export const DELETE = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { labelId } = await params;
  const label = getLabel(ctx, labelId);
  assert(can.createLabel(ctx.role), "Viewers cannot delete instructions.");

  run("DELETE FROM labels WHERE id = ? AND workspace_id = ?", labelId, ctx.workspace.id);

  emit(ctx.workspace.id, {
    type: "label",
    projectId: label.project_id,
    payload: { deleted: labelId },
  });

  return json({ ok: true });
});
