import { noEmDash } from "./format";
import { id, many, now, one, run, tx } from "./db";
import { readBuffer } from "./storage";
import { transcribe, SttUnavailable } from "./ai/stt";
import { labelNote } from "./ai/labeler";
import { emit } from "./activity";
import { loadBrief } from "./queries";
import { briefForPrompt } from "./brief";
import type { Ctx } from "./tenancy";
import type { Label, Note, TranscriptSegment, Video } from "./types";

/**
 * Voice note → transcript → cut list.
 *
 * Runs inline on the request rather than in a queue: a voice note is seconds
 * long, the creator is watching, and a job runner would be a second moving part
 * for no gain at this scale. Each stage records its own failure on the note so
 * a broken key never loses the recording.
 */

export interface ProcessResult {
  note: Note & { segments: TranscriptSegment[] };
  labels: Label[];
  origin: "ai" | "heuristic";
  model: string;
  warning?: string;
}

export async function transcribeNote(ctx: Ctx, note: Note): Promise<Note> {
  if (note.kind !== "voice" || !note.audio_key) return note;

  run(
    "UPDATE notes SET transcribe_status = 'running', transcribe_error = NULL WHERE id = ? AND workspace_id = ?",
    note.id,
    ctx.workspace.id,
  );

  try {
    const audio = await readBuffer(note.audio_key);
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

    const result = await transcribe(
      ctx.workspace.id,
      audio,
      `note.${extension}`,
      mime,
    );

    tx(() => {
      run(
        "DELETE FROM transcript_segments WHERE note_id = ? AND workspace_id = ?",
        note.id,
        ctx.workspace.id,
      );
      result.segments.forEach((segment, index) => {
        run(
          `INSERT INTO transcript_segments
             (id, workspace_id, note_id, idx, start_ms, end_ms, text, confidence)
           VALUES (?,?,?,?,?,?,?,?)`,
          id("seg"),
          ctx.workspace.id,
          note.id,
          index,
          segment.start_ms,
          segment.end_ms,
          noEmDash(segment.text),
          segment.confidence,
        );
      });
      run(
        "UPDATE notes SET text = ?, transcribe_status = 'done', transcribe_error = NULL, stt_provider = ? WHERE id = ? AND workspace_id = ?",
        noEmDash(result.text),
        `${result.provider}:${result.model}`,
        note.id,
        ctx.workspace.id,
      );
    });
  } catch (err) {
    const message =
      err instanceof SttUnavailable
        ? err.message
        : `Transcription failed: ${(err as Error).message}`;
    run(
      "UPDATE notes SET transcribe_status = 'failed', transcribe_error = ? WHERE id = ? AND workspace_id = ?",
      message.slice(0, 400),
      note.id,
      ctx.workspace.id,
    );
  }

  return one<Note>(
    "SELECT * FROM notes WHERE id = ? AND workspace_id = ?",
    note.id,
    ctx.workspace.id,
  )!;
}

export async function labelAndSave(
  ctx: Ctx,
  note: Note,
): Promise<{ labels: Label[]; origin: "ai" | "heuristic"; model: string }> {
  if (!note.text.trim()) return { labels: [], origin: "heuristic", model: "none" };

  const video = note.video_id
    ? one<Video>(
        "SELECT * FROM videos WHERE id = ? AND workspace_id = ?",
        note.video_id,
        ctx.workspace.id,
      )
    : null;

  const brief = loadBrief(ctx, note.project_id);
  const briefForAi = Object.keys(brief.payload).length
    ? briefForPrompt(brief.payload)
    : null;

  const result = await labelNote(ctx.workspace.id, {
    text: note.text,
    anchorMs: note.anchor_ms,
    durationMs: video?.duration_ms ?? 0,
    videoTitle: video?.title,
    brief: briefForAi,
  });

  tx(() => {
    // Re-labelling replaces this note's machine output but never touches
    // labels the editor typed by hand or has already worked on.
    run(
      "DELETE FROM labels WHERE note_id = ? AND workspace_id = ? AND origin != 'manual' AND status = 'open'",
      note.id,
      ctx.workspace.id,
    );

    for (const draft of result.labels) {
      run(
        `INSERT INTO labels
           (id, workspace_id, project_id, video_id, note_id, type, title, detail,
            start_ms, end_ms, priority, status, confidence, origin, assignee_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id("lab"),
        ctx.workspace.id,
        note.project_id,
        note.video_id,
        note.id,
        draft.type,
        noEmDash(draft.title).slice(0, 200),
        noEmDash(draft.detail).slice(0, 2000),
        draft.start_ms,
        draft.end_ms,
        draft.priority,
        "open",
        draft.confidence,
        result.origin,
        null,
        now(),
        now(),
      );
    }
  });

  const labels = many<Label>(
    "SELECT * FROM labels WHERE note_id = ? AND workspace_id = ? ORDER BY start_ms",
    note.id,
    ctx.workspace.id,
  );

  return { labels, origin: result.origin, model: result.model };
}

/** The whole pipeline, as triggered from the walkthrough after a recording lands. */
// One pass per note at a time. The recorder asks for processing straight after
// the upload and a retry can arrive while that is still running, and paying a
// speech-to-text provider twice for the same recording is not acceptable.
const globalForNotes = globalThis as unknown as { __cutlistNotes?: Set<string> };
const inFlight: Set<string> = globalForNotes.__cutlistNotes ?? new Set<string>();
globalForNotes.__cutlistNotes = inFlight;

export function isProcessingNote(noteId: string): boolean {
  return inFlight.has(noteId);
}

/** What the note looks like right now, without doing any work. */
function snapshot(ctx: Ctx, noteId: string): ProcessResult {
  const note = one<Note>(
    "SELECT * FROM notes WHERE id = ? AND workspace_id = ?",
    noteId,
    ctx.workspace.id,
  );
  if (!note) throw new Error("Note not found.");

  return {
    note: {
      ...note,
      segments: many<TranscriptSegment>(
        "SELECT * FROM transcript_segments WHERE note_id = ? AND workspace_id = ? ORDER BY idx",
        noteId,
        ctx.workspace.id,
      ),
    },
    labels: many<Label>(
      "SELECT * FROM labels WHERE note_id = ? AND workspace_id = ? ORDER BY start_ms",
      noteId,
      ctx.workspace.id,
    ),
    origin: "heuristic",
    model: "in-progress",
  };
}

export async function processNote(
  ctx: Ctx,
  noteId: string,
  options: { transcribe?: boolean } = {},
): Promise<ProcessResult> {
  if (inFlight.has(noteId)) return snapshot(ctx, noteId);
  inFlight.add(noteId);
  try {
    return await runProcess(ctx, noteId, options);
  } finally {
    inFlight.delete(noteId);
  }
}

async function runProcess(
  ctx: Ctx,
  noteId: string,
  options: { transcribe?: boolean },
): Promise<ProcessResult> {
  let note = one<Note>(
    "SELECT * FROM notes WHERE id = ? AND workspace_id = ?",
    noteId,
    ctx.workspace.id,
  );
  if (!note) throw new Error("Note not found.");

  if (options.transcribe !== false && note.kind === "voice") {
    note = await transcribeNote(ctx, note);
  }

  const { labels, origin, model } = await labelAndSave(ctx, note);

  const segments = many<TranscriptSegment>(
    "SELECT * FROM transcript_segments WHERE note_id = ? AND workspace_id = ? ORDER BY idx",
    note.id,
    ctx.workspace.id,
  );

  const full = { ...note, segments };

  emit(ctx.workspace.id, {
    type: "note",
    projectId: note.project_id,
    payload: full,
  });
  emit(
    ctx.workspace.id,
    { type: "label", projectId: note.project_id, payload: { noteId: note.id, labels } },
    labels.length
      ? {
          actorId: ctx.user.id,
          verb: "labels.extracted",
          summary: `${labels.length} instruction${labels.length === 1 ? "" : "s"} extracted from a note`,
        }
      : undefined,
  );

  return {
    note: full,
    labels,
    origin,
    model,
    warning: note.transcribe_status === "failed" ? (note.transcribe_error ?? undefined) : undefined,
  };
}
