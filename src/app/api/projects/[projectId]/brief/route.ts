import { body, json, route } from "@/lib/api";
import { now, run } from "@/lib/db";
import { assert, can, getProject, requireCtx } from "@/lib/tenancy";
import { completeness, sanitiseBrief } from "@/lib/brief";
import { emit } from "@/lib/activity";
import { loadBrief } from "@/lib/queries";

type Params = { params: Promise<{ projectId: string }> };

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  return json(loadBrief(ctx, projectId));
});

export const PUT = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.editBrief(ctx.role), "Only owners and creators can edit the brief.");

  const raw = await body<{ values?: unknown }>(req);
  const values = sanitiseBrief(raw.values);
  const score = completeness(values);

  run(
    `INSERT INTO briefs (project_id, workspace_id, payload, completeness, updated_by, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (project_id) DO UPDATE SET
       payload = excluded.payload,
       completeness = excluded.completeness,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    projectId,
    ctx.workspace.id,
    JSON.stringify(values),
    score,
    ctx.user.id,
    now(),
  );

  run(
    "UPDATE projects SET updated_at = ? WHERE id = ? AND workspace_id = ?",
    now(),
    projectId,
    ctx.workspace.id,
  );

  emit(
    ctx.workspace.id,
    { type: "brief", projectId, payload: { completeness: score } },
    {
      actorId: ctx.user.id,
      verb: "brief.updated",
      summary: `Brief for ${project.name} is ${score}% complete`,
    },
  );

  return json({ payload: values, completeness: score, updated_at: now() });
});
