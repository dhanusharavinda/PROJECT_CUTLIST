import fs from "node:fs";
import { Readable } from "node:stream";
import { route } from "@/lib/api";
import { getVideo, HttpError, requireCtx } from "@/lib/tenancy";
import { resolveKey } from "@/lib/storage";
import { streamFile } from "@/lib/drive";

type Params = { params: Promise<{ videoId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves footage to the player.
 *
 * Access is decided by `getVideo`, which pins the workspace, so a video id from
 * another tenant 404s before a single byte is read. Range requests are honoured
 * so the browser can seek without downloading the whole file.
 */
export const GET = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);

  // A local copy always wins: it seeks instantly, costs no Drive egress, and
  // it is the file the analyser measured. The preview copy wins over the
  // original, because an HEVC original will not decode in a browser at all.
  const localKey = video.proxy_key ?? video.storage_key;

  if (!localKey && video.source === "drive" && video.drive_file_id) {
    const upstream = await streamFile(
      ctx.workspace.id,
      video.drive_file_id,
      req.headers.get("range"),
    );
    const headers = new Headers();
    for (const key of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set("Cache-Control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  if (!localKey && video.source === "link" && video.external_url) {
    return Response.redirect(video.external_url, 302);
  }

  if (!localKey) throw new HttpError(404, "This clip has no file.");

  const path = resolveKey(localKey);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch {
    throw new HttpError(404, "The file for this clip is missing from storage.");
  }

  const range = req.headers.get("range");
  const headers = new Headers({
    "Content-Type": video.proxy_key ? "video/mp4" : video.mime || "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
  });

  if (!range) {
    headers.set("Content-Length", String(stat.size));
    const stream = Readable.toWeb(
      fs.createReadStream(path),
    ) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: 200, headers });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` },
    });
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;

  if (Number.isNaN(start) || start >= stat.size || end < start) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` },
    });
  }

  headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  headers.set("Content-Length", String(end - start + 1));

  const stream = Readable.toWeb(
    fs.createReadStream(path, { start, end }),
  ) as ReadableStream<Uint8Array>;

  return new Response(stream, { status: 206, headers });
});
