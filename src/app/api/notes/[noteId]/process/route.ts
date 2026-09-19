import { json, route } from "@/lib/api";
import { assert, can, getNote, requireCtx } from "@/lib/tenancy";
import { processNote } from "@/lib/pipeline";

type Params = { params: Promise<{ noteId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Whisper on a two-minute note is comfortably inside this; AssemblyAI polls.
export const maxDuration = 300;

/**
 * Transcribe (voice notes) and label. Called right after a recording uploads,
 * and again by hand from the UI after a key is added or the text is corrected.
 *
 * `?transcribe=0` re-runs labelling only. Used when the creator edits the
 * transcript, where re-hitting the STT provider would be wasteful and wrong.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { noteId } = await params;
  const note = getNote(ctx, noteId);
  assert(can.runAi(ctx.role), "Viewers cannot run the labeller.");

  const url = new URL(req.url);
  const shouldTranscribe = url.searchParams.get("transcribe") !== "0";

  const result = await processNote(ctx, note.id, {
    transcribe: shouldTranscribe,
  });

  return json(result);
});
