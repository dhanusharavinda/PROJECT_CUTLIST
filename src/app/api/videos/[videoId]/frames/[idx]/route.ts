import { route } from "@/lib/api";
import { getVideo, notFound, requireCtx } from "@/lib/tenancy";
import { getFrame } from "@/lib/analysis/store";
import { readBuffer } from "@/lib/storage";

type Params = { params: Promise<{ videoId: string; idx: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One analysis thumbnail. Access is decided by `getVideo`, which pins the
 * workspace, so a frame id from another tenant is a 404 like any other.
 */
export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId, idx } = await params;
  const video = getVideo(ctx, videoId);

  const index = Number(idx);
  if (!Number.isFinite(index) || index < 0) throw notFound("No such frame.");

  const frame = getFrame(ctx, video.id, Math.round(index));
  if (!frame) throw notFound("No such frame.");

  let data: Buffer;
  try {
    data = await readBuffer(frame.storage_key);
  } catch {
    throw notFound("That frame is no longer on disk. Re-run the analysis.");
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(data.byteLength),
      // Frames are replaced wholesale by a new pass, and the URL carries the
      // clip id, so a private cache is safe and keeps the panel snappy.
      "Cache-Control": "private, max-age=300",
    },
  });
});
