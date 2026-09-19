import { json, route } from "@/lib/api";
import { assert, can, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { convertToInstruction, getRecommendation } from "@/lib/graph/recommendations";

type Params = { params: Promise<{ recommendationId: string }> };

export const dynamic = "force-dynamic";

/** A suggestion becomes an instruction. Only a person can press this. */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { recommendationId } = await params;
  assert(can.editBrief(ctx.role), "Only owners and creators turn suggestions into instructions.");

  const before = getRecommendation(ctx, recommendationId);
  const label = convertToInstruction(ctx, recommendationId);

  emit(
    ctx.workspace.id,
    { type: "label", projectId: before.project_id, payload: { labelId: label.id } },
    {
      actorId: ctx.user.id,
      verb: "recommendation.converted",
      summary: `Suggestion accepted into the cut list: ${label.title}`,
    },
  );

  return json({ label, recommendation: getRecommendation(ctx, recommendationId) });
});
