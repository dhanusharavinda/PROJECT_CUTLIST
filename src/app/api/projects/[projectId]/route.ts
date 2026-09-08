import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { now, run } from "@/lib/db";
import { assert, can, getProject, requireCtx } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";
import { loadProjectDetail } from "@/lib/queries";

type Params = { params: Promise<{ projectId: string }> };

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  return json(loadProjectDetail(ctx, getProject(ctx, projectId)));
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(600).optional(),
  status: z
    .enum(["briefing", "editing", "review", "delivered", "archived"])
    .optional(),
  dueAt: z.number().int().nullable().optional(),
});

export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);

  const input = Patch.parse(await body(req));

  // Editors may move a project along the pipeline; only creators rename it.
  if (input.name !== undefined || input.summary !== undefined || input.dueAt !== undefined) {
    assert(can.editBrief(ctx.role), "Only owners and creators can edit project details.");
  } else {
    assert(can.updateLabelStatus(ctx.role), "Viewers cannot change a project.");
  }

  run(
    `UPDATE projects
        SET name = COALESCE(?, name),
            summary = COALESCE(?, summary),
            status = COALESCE(?, status),
            due_at = CASE WHEN ? THEN ? ELSE due_at END,
            updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
    input.name ?? null,
    input.summary ?? null,
    input.status ?? null,
    input.dueAt !== undefined ? 1 : 0,
    input.dueAt ?? null,
    now(),
    projectId,
    ctx.workspace.id,
  );

  if (input.status && input.status !== project.status) {
    logActivity({
      workspaceId: ctx.workspace.id,
      projectId,
      actorId: ctx.user.id,
      verb: "project.status",
      summary: `${project.name} moved to ${input.status}`,
    });
  }

  return json(loadProjectDetail(ctx, getProject(ctx, projectId)));
});

export const DELETE = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.createProject(ctx.role), "Only owners and creators can delete a project.");

  run(
    "DELETE FROM projects WHERE id = ? AND workspace_id = ?",
    projectId,
    ctx.workspace.id,
  );
  logActivity({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    verb: "project.deleted",
    summary: `${project.name} deleted`,
  });

  return json({ ok: true });
});
