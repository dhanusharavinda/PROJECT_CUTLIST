import { json, route } from "@/lib/api";
import { assert, badRequest, can, getVideo, requireCtx } from "@/lib/tenancy";
import { isAnalysing, NotAnalysable, startAnalysis } from "@/lib/analysis/analyze";
import { FfmpegMissing, ffmpegStatus } from "@/lib/analysis/ffmpeg";
import {
  getAnalysis,
  latestPlan,
  listFrames,
  listTags,
} from "@/lib/analysis/store";

type Params = { params: Promise<{ videoId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Status, measurements, thumbnails and tags for one clip. */
export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);

  const analysis = getAnalysis(ctx, video.id);
  return json({
    analysis,
    running: isAnalysing(video.id),
    frames: listFrames(ctx, video.id).map((f) => ({ idx: f.idx, at_ms: f.at_ms })),
    tags: listTags(ctx, video.id).map((t) => ({ tag: t.tag, kind: t.kind })),
    plan: latestPlan(ctx, video.id),
    ffmpeg: ffmpegStatus().ok,
  });
});

/**
 * Start a pass. ffmpeg on a long clip outlives the request, so this returns as
 * soon as the row says "running" and the panel polls GET until it settles.
 */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.runAi(ctx.role), "Viewers cannot run footage analysis.");

  try {
    const { started } = startAnalysis(ctx, video);
    return json({ started, analysis: getAnalysis(ctx, video.id) });
  } catch (err) {
    if (err instanceof FfmpegMissing || err instanceof NotAnalysable) {
      throw badRequest(err.message);
    }
    throw err;
  }
});
