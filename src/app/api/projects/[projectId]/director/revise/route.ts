import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { now, run } from "@/lib/db";
import { assert, badRequest, can, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { LlmUnavailable } from "@/lib/ai/llm";
import { NothingToDirect } from "@/lib/director/run";
import { reviseWithAi } from "@/lib/director/revise";
import { createProjectVersion } from "@/lib/graph/versions";
import { recordEvent } from "@/lib/graph/events";

type Params = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Revise = z.object({
  request: z.string().trim().min(3, "Say what should change.").max(1000),
});

/**
 * "Make the middle faster but leave the hook alone."
 *
 * The request becomes a scope, the director runs only inside it, and the
 * result is recorded as an AI revision version with the scope on it, so the
 * history says exactly which parts were open and which were locked.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.runAi(ctx.role), "Viewers cannot ask the AI to revise.");

  const { request } = Revise.parse(await body(req));

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
    const { plan, result } = await reviseWithAi(ctx, projectId, request);

    const version = createProjectVersion(ctx, projectId, {
      kind: "ai_revision",
      title: `AI revision: ${plan.summary.slice(0, 80)}`,
      summary: plan.summary,
      actorKind: "ai",
      actorId: ctx.user.id,
      payload: {
        proposed_recommendations: result.created.filter((r) => r.status === "proposed").length,
        changes: [
          `Changed: ${plan.modify.join(", ")}`,
          plan.lock.length ? `Left alone: ${plan.lock.join(", ")}` : "Nothing was locked",
        ],
      },
    });

    setOwner("awaiting_creator");
    recordEvent(ctx, projectId, {
      kind: "owner.changed",
      actorKind: "system",
      payload: { from: "ai_executing", to: "awaiting_creator", reason: "revision finished" },
    });

    emit(
      ctx.workspace.id,
      { type: "graph", projectId, payload: { owner_state: "awaiting_creator", run: result.runId } },
      {
        actorId: ctx.user.id,
        verb: "director.revised",
        summary: `AI revised ${plan.modify.join(", ")} on ${project.name}${plan.lock.length ? `, left ${plan.lock.join(", ")} alone` : ""}`,
      },
    );

    return json({ plan, ...result, version });
  } catch (err) {
    setOwner(project.owner_state);
    emit(ctx.workspace.id, { type: "graph", projectId, payload: { owner_state: project.owner_state } });
    if (err instanceof LlmUnavailable || err instanceof NothingToDirect) throw badRequest(err.message);
    throw err;
  }
});
