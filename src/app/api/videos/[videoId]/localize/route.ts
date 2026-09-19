import { json, route } from "@/lib/api";
import { assert, badRequest, can, getVideo, requireCtx } from "@/lib/tenancy";
import {
  enqueueLocalize,
  importProgress,
  isImporting,
  releaseLocal,
} from "@/lib/media/localize";

type Params = { params: Promise<{ videoId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Where the copy has got to. The footage panel polls this while it runs. */
export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);

  return json({
    state: video.local_state,
    error: video.local_error,
    hasLocal: Boolean(video.storage_key),
    hasProxy: Boolean(video.proxy_key),
    running: isImporting(video.id),
    progress: importProgress(video.id),
  });
});

/** Copy a Drive clip to disk, make a preview if needed, then read it. */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot import footage.");

  if (video.source === "link") {
    throw badRequest(
      "A linked clip stays where it is. Attach it from Drive or upload the file to work on it here.",
    );
  }

  const { queued } = enqueueLocalize(ctx, video);
  return json({ queued, state: queued ? "copying" : video.local_state });
});

/** Give the disk space back. The clip stays attached and streams from Drive. */
export const DELETE = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot change footage.");

  if (isImporting(video.id)) {
    throw badRequest("That copy is still running. Let it finish first.");
  }

  try {
    await releaseLocal(ctx, video);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
  return json({ ok: true });
});
