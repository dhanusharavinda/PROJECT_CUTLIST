import { route } from "@/lib/api";
import { assert, badRequest, can, notFound, requireCtx } from "@/lib/tenancy";
import { thumbnail } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A Drive thumbnail, proxied.
 *
 * Google's thumbnailLink needs the workspace's token, which the browser does
 * not have, so the picker used to show forty identical grey rows named
 * IMG_48xx. Membership-gated like every other media path here.
 */
export const GET = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.uploadMedia(ctx.role), "Viewers cannot browse Drive.");

  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) throw badRequest("A fileId is required.");

  // A missing thumbnail is routine: no connection, a file Google has not
  // processed yet, a revoked token. The picker falls back to an icon, so this
  // has to be a 404 and never a server error in the log.
  let image: Awaited<ReturnType<typeof thumbnail>> = null;
  try {
    image = await thumbnail(ctx.workspace.id, fileId);
  } catch {
    image = null;
  }
  if (!image) throw notFound("Drive has no thumbnail for that file.");

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.byteLength),
      // Cheap to refetch, and a Drive thumbnail URL expires; keep it short.
      "Cache-Control": "private, max-age=600",
    },
  });
});
