import { many, now, one, run } from "./db";
import type { Ctx } from "./tenancy";
import { can } from "./tenancy";
import type {
  Label,
  Member,
  Message,
  Note,
  Project,
  TranscriptSegment,
  Video,
} from "./types";
import { sanitiseBrief, type BriefValues } from "./brief";
import { hasLlm } from "./ai/llm";
import { resolveStt } from "./ai/stt";
import { getSetting } from "./ai/keys";
import { ffmpegStatus } from "./analysis/ffmpeg";
import { listAnalyses, type AnalysisView } from "./analysis/store";
import { listRecommendations, type Recommendation } from "./graph/recommendations";
import { listProjectVersions, type ProjectVersionView } from "./graph/versions";
import { getTemplateVersion } from "./templates/store";
import { reelView } from "./reel/store";
import type { ReelView } from "./reel/types";

/**
 * Every query in here takes `ctx.workspace.id` as its first predicate. Server
 * components and API routes both read through this module so there is exactly
 * one place where the tenant filter could be forgotten.
 */

export interface NoteWithTranscript extends Note {
  author_name: string | null;
  segments: TranscriptSegment[];
}

export interface MessageWithAuthor extends Message {
  author_name: string | null;
}

export interface ProjectDetail {
  project: Project;
  brief: { payload: BriefValues; completeness: number; updated_at: number };
  videos: Video[];
  notes: NoteWithTranscript[];
  labels: Label[];
  messages: MessageWithAuthor[];
  members: Member[];
  suggestion: { id: string; payload: string; model: string; created_at: number } | null;
  me: { id: string; name: string; email: string; role: string };
  capabilities: {
    canEditBrief: boolean;
    canUpload: boolean;
    canNote: boolean;
    canLabel: boolean;
    canChat: boolean;
    canRunAi: boolean;
    canDelete: boolean;
  };
  ai: { stt: string | null; llm: boolean };
  /** What ffmpeg measured about each clip in this project. */
  analyses: AnalysisView[];
  /** The ordered reel: which clip plays when, and for how long. */
  reel: ReelView;
  /** Whether footage analysis can run on this machine at all. */
  ffmpeg: boolean;
  /** One-person workspace: no room, no presence. */
  solo: boolean;
  /** What the AI has proposed and not yet been decided on or replaced. */
  recommendations: Recommendation[];
  /** V1 AI draft, V2 human edit, and so on. */
  versions: ProjectVersionView[];
  /** The template this project came from, as a name and a version number. */
  template: { id: string; name: string; version: number } | null;
}

export function listVideos(ctx: Ctx, projectId: string): Video[] {
  return many<Video>(
    "SELECT * FROM videos WHERE workspace_id = ? AND project_id = ? ORDER BY position ASC, created_at ASC",
    ctx.workspace.id,
    projectId,
  );
}

export function listLabels(ctx: Ctx, projectId: string): Label[] {
  return many<Label>(
    `SELECT * FROM labels
      WHERE workspace_id = ? AND project_id = ?
      ORDER BY start_ms ASC, created_at ASC`,
    ctx.workspace.id,
    projectId,
  );
}

/**
 * Self-heal for interrupted transcription.
 *
 * The recorder triggers transcription from the browser right after the upload,
 * so a closed tab, a reload or a dropped connection used to leave a note
 * spinning on "Transcribing" with no way out. Anything stuck far longer than a
 * plausible run becomes a failure, which is a state the UI offers a retry from.
 */
function recoverStalledNotes(ctx: Ctx, projectId: string) {
  run(
    `UPDATE notes
        SET transcribe_status = 'failed',
            transcribe_error = 'Transcription was interrupted before it finished. Press retry, or type the note yourself.'
      WHERE workspace_id = ? AND project_id = ?
        AND ((transcribe_status = 'queued' AND created_at < ?)
          OR (transcribe_status = 'running' AND created_at < ?))`,
    ctx.workspace.id,
    projectId,
    now() - 120_000,
    now() - 600_000,
  );
}

export function listNotes(ctx: Ctx, projectId: string): NoteWithTranscript[] {
  recoverStalledNotes(ctx, projectId);

  const notes = many<Note & { author_name: string | null }>(
    `SELECT n.*, u.name AS author_name
       FROM notes n
       LEFT JOIN users u ON u.id = n.author_id
      WHERE n.workspace_id = ? AND n.project_id = ?
      ORDER BY n.created_at DESC`,
    ctx.workspace.id,
    projectId,
  );
  if (notes.length === 0) return [];

  const segments = many<TranscriptSegment & { workspace_id: string }>(
    `SELECT s.* FROM transcript_segments s
       JOIN notes n ON n.id = s.note_id
      WHERE s.workspace_id = ? AND n.project_id = ?
      ORDER BY s.note_id, s.idx`,
    ctx.workspace.id,
    projectId,
  );

  const byNote = new Map<string, TranscriptSegment[]>();
  for (const segment of segments) {
    const list = byNote.get(segment.note_id) ?? [];
    list.push(segment);
    byNote.set(segment.note_id, list);
  }

  return notes.map((note) => ({
    ...note,
    segments: byNote.get(note.id) ?? [],
  }));
}

export function listMessages(
  ctx: Ctx,
  projectId: string,
  limit = 200,
): MessageWithAuthor[] {
  const rows = many<MessageWithAuthor>(
    `SELECT m.*, u.name AS author_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.workspace_id = ? AND m.project_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?`,
    ctx.workspace.id,
    projectId,
    limit,
  );
  return rows.reverse();
}

export function listMembers(ctx: Ctx): Member[] {
  return many<Member>(
    `SELECT u.id, u.email, u.name, u.accent, u.created_at, m.role, m.id AS membership_id
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY u.name`,
    ctx.workspace.id,
  );
}

export function loadBrief(ctx: Ctx, projectId: string) {
  const row = one<{ payload: string; completeness: number; updated_at: number }>(
    "SELECT payload, completeness, updated_at FROM briefs WHERE project_id = ? AND workspace_id = ?",
    projectId,
    ctx.workspace.id,
  );
  let payload: BriefValues = {};
  if (row?.payload) {
    try {
      payload = sanitiseBrief(JSON.parse(row.payload));
    } catch {
      payload = {};
    }
  }
  return {
    payload,
    completeness: row?.completeness ?? 0,
    updated_at: row?.updated_at ?? 0,
  };
}

export function loadProjectDetail(ctx: Ctx, project: Project): ProjectDetail {
  const stt = resolveStt(ctx.workspace.id);

  return {
    project,
    brief: loadBrief(ctx, project.id),
    videos: listVideos(ctx, project.id),
    notes: listNotes(ctx, project.id),
    labels: listLabels(ctx, project.id),
    messages: listMessages(ctx, project.id),
    members: listMembers(ctx),
    suggestion: one(
      "SELECT id, payload, model, created_at FROM suggestions WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1",
      ctx.workspace.id,
      project.id,
    ),
    me: {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      role: ctx.role,
    },
    capabilities: {
      canEditBrief: can.editBrief(ctx.role),
      canUpload: can.uploadMedia(ctx.role),
      canNote: can.createNote(ctx.role),
      canLabel: can.createLabel(ctx.role),
      canChat: can.chat(ctx.role),
      canRunAi: can.runAi(ctx.role),
      canDelete: can.createProject(ctx.role),
    },
    ai: {
      stt: stt ? stt.provider.label : null,
      llm: hasLlm(ctx.workspace.id),
    },
    analyses: listAnalyses(ctx, project.id),
    reel: reelView(ctx, project.id),
    ffmpeg: ffmpegStatus().ok,
    solo: getSetting(ctx.workspace.id, "SOLO_MODE") === "on",
    recommendations: listRecommendations(ctx, project.id, { live: true }),
    versions: listProjectVersions(ctx, project.id),
    template: templateSummary(ctx, project.template_version_id),
  };
}

function templateSummary(
  ctx: Ctx,
  versionId: string | null,
): { id: string; name: string; version: number } | null {
  if (!versionId) return null;
  const found = getTemplateVersion(ctx, versionId);
  if (!found) return null;
  return {
    id: found.version.template_id,
    name: found.template?.name ?? "Deleted template",
    version: found.version.version,
  };
}

/** Everything the AI needs to reason about a project, in one scoped read. */
export function loadAiContext(ctx: Ctx, projectId: string) {
  const videos = listVideos(ctx, projectId);
  const notes = listNotes(ctx, projectId);
  const labels = listLabels(ctx, projectId);
  const brief = loadBrief(ctx, projectId);
  const titleById = new Map(videos.map((v) => [v.id, v.title]));

  return {
    brief,
    videos,
    labels,
    transcripts: notes
      .filter((n) => n.text.trim().length > 0)
      .map((n) => ({
        video: n.video_id ? (titleById.get(n.video_id) ?? "project") : "project",
        anchor_ms: n.anchor_ms,
        text: n.text,
      })),
  };
}
