import { json, route } from "@/lib/api";
import { id, now, one, run } from "@/lib/db";
import { assert, badRequest, can, getProject, getVideo, requireCtx } from "@/lib/tenancy";
import { buildKey, maxUploadBytes, removeKey, writeStream } from "@/lib/storage";
import { emit } from "@/lib/activity";
import { listNotes } from "@/lib/queries";
import type { Note } from "@/lib/types";

type Params = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  return json({ notes: listNotes(ctx, projectId) });
});

/**
 * Two shapes on one route:
 *   application/json  → a typed note
 *   anything else     → a raw audio body (voice note), metadata on the query
 *
 * The playhead position travels with the recording. That is what makes
 * "cut this bit right here" resolvable later.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.createNote(ctx.role), "Viewers cannot leave notes.");

  const url = new URL(req.url);
  const contentType = req.headers.get("content-type") || "";
  const noteId = id("not");

  let videoId: string | null = null;
  let anchorMs = 0;
  let text = "";
  let audioKey: string | null = null;
  let audioMs = 0;
  let kind: "voice" | "text" = "text";

  if (contentType.includes("application/json")) {
    const payload = (await req.json()) as {
      videoId?: string | null;
      anchorMs?: number;
      text?: string;
    };
    text = String(payload.text ?? "").trim();
    if (!text) throw badRequest("The note is empty.");
    if (text.length > 20000) throw badRequest("That note is too long.");
    videoId = payload.videoId ?? null;
    anchorMs = Math.max(0, Math.round(Number(payload.anchorMs ?? 0)) || 0);
  } else {
    kind = "voice";
    videoId = url.searchParams.get("videoId");
    anchorMs = Math.max(0, Math.round(Number(url.searchParams.get("anchor") || 0)));
    audioMs = Math.max(0, Math.round(Number(url.searchParams.get("audioMs") || 0)));
    const mime = url.searchParams.get("mime") || "audio/webm";

    if (!req.body) throw badRequest("No audio was received.");
    if (!mime.startsWith("audio/") && !mime.startsWith("video/"))
      throw badRequest("That is not an audio recording.");

    const extension = mime.includes("mp4")
      ? "m4a"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("mpeg")
            ? "mp3"
            : "webm";

    audioKey = buildKey(ctx.workspace.id, "audio", `note-${noteId}.${extension}`);
    // 40 MB is minutes of speech; the video limit would be absurd here.
    const cap = Math.min(maxUploadBytes(), 40 * 1024 * 1024);
    let size = 0;
    try {
      size = await writeStream(audioKey, req.body, cap);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    if (size === 0) {
      await removeKey(audioKey);
      throw badRequest("The recording was empty — try holding the button longer.");
    }
  }

  // A video id from another workspace must not become an anchor.
  if (videoId) {
    const video = getVideo(ctx, videoId);
    if (video.project_id !== projectId)
      throw badRequest("That clip belongs to a different project.");
  }

  run(
    `INSERT INTO notes
       (id, workspace_id, project_id, video_id, author_id, kind, audio_key, audio_ms,
        text, anchor_ms, transcribe_status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    noteId,
    ctx.workspace.id,
    projectId,
    videoId,
    ctx.user.id,
    kind,
    audioKey,
    audioMs,
    text,
    anchorMs,
    kind === "voice" ? "queued" : "none",
    now(),
  );

  run(
    "UPDATE projects SET updated_at = ? WHERE id = ? AND workspace_id = ?",
    now(),
    projectId,
    ctx.workspace.id,
  );

  const note = one<Note>(
    "SELECT * FROM notes WHERE id = ? AND workspace_id = ?",
    noteId,
    ctx.workspace.id,
  );

  emit(
    ctx.workspace.id,
    { type: "note", projectId, payload: { ...note, segments: [] } },
    {
      actorId: ctx.user.id,
      verb: kind === "voice" ? "note.recorded" : "note.written",
      summary:
        kind === "voice"
          ? `${ctx.user.name} recorded a note on ${project.name}`
          : `${ctx.user.name} left a note on ${project.name}`,
    },
  );

  return json({ note: { ...note, segments: [] } });
});
