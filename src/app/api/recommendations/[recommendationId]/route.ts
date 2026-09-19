import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, badRequest, can, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import {
  getRecommendation,
  modify,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_TYPES,
  setStatus,
} from "@/lib/graph/recommendations";

type Params = { params: Promise<{ recommendationId: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { recommendationId } = await params;
  return json({ recommendation: getRecommendation(ctx, recommendationId) });
});

const Patch = z.object({
  /** A decision on the suggestion as it stands. */
  status: z.enum(RECOMMENDATION_STATUSES).optional(),
  reason: z.string().trim().max(400).optional(),
  /** Or a change to it, which makes a new recommendation superseding this one. */
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().max(2000).optional(),
  type: z.enum(RECOMMENDATION_TYPES).optional(),
  startMs: z.number().int().nonnegative().nullable().optional(),
  endMs: z.number().int().nonnegative().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

/**
 * The creator decides. Approve, reject, send back for review, or change it.
 * Nothing here touches the cut list; that is the convert route, on purpose.
 */
export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { recommendationId } = await params;
  assert(can.editBrief(ctx.role), "Only owners and creators decide on suggestions.");

  const input = Patch.parse(await body(req));
  const current = getRecommendation(ctx, recommendationId);

  const isChange =
    input.title !== undefined ||
    input.detail !== undefined ||
    input.type !== undefined ||
    input.startMs !== undefined ||
    input.endMs !== undefined ||
    input.priority !== undefined;

  if (!input.status && !isChange) throw badRequest("Nothing to change.");

  const recommendation = isChange
    ? modify(ctx, recommendationId, {
        title: input.title,
        detail: input.detail,
        type: input.type,
        startMs: input.startMs,
        endMs: input.endMs,
        priority: input.priority,
      })
    : setStatus(ctx, recommendationId, input.status!, { reason: input.reason });

  emit(ctx.workspace.id, {
    type: "graph",
    projectId: current.project_id,
    payload: { recommendation: recommendation.id, status: recommendation.status },
  });

  return json({ recommendation });
});
