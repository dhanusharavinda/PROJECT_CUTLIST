import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { many, one, run } from "@/lib/db";
import { assert, badRequest, can, getNote, requireCtx } from "@/lib/tenancy";
import { removeKey } from "@/lib/storage";
import { emit } from "@/lib/activity";
import type { Note, TranscriptSegment } from "@/lib/types";

type Params = { params: Promise<{ noteId: string }> };

const Patch = z.object({
  text: z.string().max(20000).optional(),
  anchorMs: z.number().int().nonnegative().optional(),
});

/** Correcting a mis-heard transcript is the most common edit here. */
export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { noteId } = await params;
  const note = getNote(ctx, noteId);

  if (note.author_id !== ctx.user.id && !can.editBrief(ctx.role)) {
    throw badRequest("You can only edit your own notes.");
  }

  const input = Patch.parse(await body(req));
  run(
    `UPDATE notes
        SET text = COALESCE(?, text),
            anchor_ms = COALESCE(?, anchor_ms),
            transcribe_status = CASE WHEN ? IS NOT NULL AND transcribe_status = 'failed'
                                     THEN 'done' ELSE transcribe_status END
      WHERE id = ? AND workspace_id = ?`,
    input.text ?? null,
    input.anchorMs ?? null,
    input.text ?? null,
    noteId,
    ctx.workspace.id,
  );

  const updated = one<Note>(
    "SELECT * FROM notes WHERE id = ? AND workspace_id = ?",
    noteId,
    ctx.workspace.id,
  )!;
  const segments = many<TranscriptSegment>(
    "SELECT * FROM transcript_segments WHERE note_id = ? AND workspace_id = ? ORDER BY idx",
    noteId,
    ctx.workspace.id,
  );

  emit(ctx.workspace.id, {
    type: "note",
    projectId: note.project_id,
    payload: { ...updated, segments },
  });

  return json({ note: { ...updated, segments } });
});

export const DELETE = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { noteId } = await params;
  const note = getNote(ctx, noteId);

  if (note.author_id !== ctx.user.id && !can.editBrief(ctx.role)) {
    throw badRequest("You can only delete your own notes.");
  }
  assert(can.createNote(ctx.role), "Viewers cannot delete notes.");

  run("DELETE FROM notes WHERE id = ? AND workspace_id = ?", noteId, ctx.workspace.id);
  if (note.audio_key) await removeKey(note.audio_key).catch(() => {});

  emit(ctx.workspace.id, {
    type: "note",
    projectId: note.project_id,
    payload: { deleted: noteId },
  });
  emit(ctx.workspace.id, {
    type: "label",
    projectId: note.project_id,
    payload: { refresh: true },
  });

  return json({ ok: true });
});
