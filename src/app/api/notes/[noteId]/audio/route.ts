import fs from "node:fs";
import { Readable } from "node:stream";
import { route } from "@/lib/api";
import { getNote, HttpError, requireCtx } from "@/lib/tenancy";
import { resolveKey } from "@/lib/storage";

type Params = { params: Promise<{ noteId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plays back the original recording. Useful when the transcript is wrong. */
export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { noteId } = await params;
  const note = getNote(ctx, noteId);

  if (!note.audio_key) throw new HttpError(404, "This note has no recording.");

  const path = resolveKey(note.audio_key);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch {
    throw new HttpError(404, "The recording is missing from storage.");
  }

  const extension = note.audio_key.split(".").pop() || "webm";
  const mime =
    extension === "m4a"
      ? "audio/mp4"
      : extension === "ogg"
        ? "audio/ogg"
        : extension === "wav"
          ? "audio/wav"
          : extension === "mp3"
            ? "audio/mpeg"
            : "audio/webm";

  const stream = Readable.toWeb(
    fs.createReadStream(path),
  ) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=60",
    },
  });
});
