import { json, route } from "@/lib/api";
import { now, run } from "@/lib/db";
import { assert, badRequest, can, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { LlmUnavailable } from "@/lib/ai/llm";
import { NothingToDirect, runDirector } from "@/lib/director/run";
import { createProjectVersion, listProjectVersions } from "@/lib/graph/versions";
import { recordEvent } from "@/lib/graph/events";

type Params = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The full director pass over the project.
 *
 * Marks the project as AI executing for the duration, hands it back to the
 * creator when done, and records V1 AI draft the first time it runs.
 */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.runAi(ctx.role), "Viewers cannot run the director.");

  const setOwner = (state: string) =>
    run(
      "UPDATE projects SET owner_state = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
      state,
      now(),
      projectId,
      ctx.workspace.id,
    );

  setOwner("ai_executing");
  emit(ctx.workspace.id, { type: "graph", projectId, payload: { owner_state: "ai_executing" } });

  try {
    const result = await runDirector(ctx, projectId, {});

    const versions = listProjectVersions(ctx, projectId);
    const version =
      versions.length === 0
        ? createProjectVersion(ctx, projectId, {
            kind: "ai_draft",
            summary: result.headline || `${result.created.length} suggestions proposed`,
            actorKind: "ai",
            actorId: ctx.user.id,
            payload: { proposed_recommendations: result.created.length },
          })
        : null;

    setOwner("awaiting_creator");
    recordEvent(ctx, projectId, {
      kind: "owner.changed",
      actorKind: "system",
      payload: { from: "ai_executing", to: "awaiting_creator", reason: "director finished" },
    });

    emit(
      ctx.workspace.id,
      { type: "graph", projectId, payload: { owner_state: "awaiting_creator", run: result.runId } },
      {
        actorId: ctx.user.id,
        verb: "director.ran",
        summary: `Director proposed ${result.created.filter((r) => r.status === "proposed").length} suggestions on ${project.name}`,
      },
    );

    return json({ ...result, version });
  } catch (err) {
    setOwner(project.owner_state);
    emit(ctx.workspace.id, { type: "graph", projectId, payload: { owner_state: project.owner_state } });
    if (err instanceof LlmUnavailable || err instanceof NothingToDirect) throw badRequest(err.message);
    throw err;
  }
});
