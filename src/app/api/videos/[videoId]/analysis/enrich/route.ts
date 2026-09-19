import { json, route } from "@/lib/api";
import { assert, badRequest, can, getVideo, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { LlmUnavailable } from "@/lib/ai/llm";
import { enrichShots, NothingToEnrich } from "@/lib/analysis/enrich";
import { recordEvent } from "@/lib/graph/events";

type Params = { params: Promise<{ videoId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * The model reads the sampled frames: subject, face, framing, blur candidates.
 * One fast-tier call per clip, never one per frame, and never the video.
 */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.runAi(ctx.role), "Viewers cannot run the AI.");

  try {
    const result = await enrichShots(ctx, video);

    recordEvent(ctx, video.project_id, {
      kind: "analysis.enriched",
      actorKind: "ai",
      subjectType: "video",
      subjectId: video.id,
      payload: { frames: result.enriched, model: result.model, run_id: result.runId },
    });
    emit(ctx.workspace.id, {
      type: "video",
      projectId: video.project_id,
      payload: { id: video.id, enriched: result.enriched },
    });

    return json(result);
  } catch (err) {
    if (err instanceof LlmUnavailable || err instanceof NothingToEnrich) {
      throw badRequest(err.message);
    }
    throw err;
  }
});
