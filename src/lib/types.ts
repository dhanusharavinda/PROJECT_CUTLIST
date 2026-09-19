export type Role = "owner" | "creator" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  accent: string;
  created_at: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: number;
}

export interface Member extends User {
  role: Role;
  membership_id: string;
}

export type ProjectStatus =
  | "briefing"
  | "editing"
  | "review"
  | "delivered"
  | "archived";

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  summary: string;
  status: ProjectStatus;
  /** Which preset the edit plans use: gym, aesthetic, surreal, vlog, general. */
  niche: string;
  reference_video_id: string | null;
  /** The Drive folder the editor is sent to. */
  footage_url: string | null;
  /** The track this reel is cut to, in the creator's words. */
  music_note: string;
  /** Bumped on every reel change, and printed in the handoff filename. */
  packet_rev: number;
  /** The template this project was created from, and the exact version. */
  template_id: string | null;
  template_version_id: string | null;
  /** Who holds the edit right now. See OWNER_STATES. */
  owner_state: OwnerState;
  due_at: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/**
 * The edit moves between the creator, an AI agent and a human editor and back.
 * Whoever holds it is the only one expected to be changing it.
 */
export const OWNER_STATES = [
  "awaiting_creator",
  "ready_for_ai",
  "ai_executing",
  "ready_for_human",
  "human_editing",
  "ready_for_review",
] as const;

export type OwnerState = (typeof OWNER_STATES)[number];

export interface Video {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  source: "upload" | "drive" | "link";
  /** "reference" clips are reels to imitate, not footage to cut. */
  role: "footage" | "reference";
  /** The filename in Drive, with its extension: what the editor searches for. */
  source_name: string;
  /** Google's own link to the file, so the handoff can point at it. */
  share_url: string | null;
  drive_parent_id: string | null;
  codec: string;
  fps: number;
  /** The app's working copy on disk. A derived cache, never the only copy. */
  local_state: "none" | "copying" | "ready" | "failed";
  local_error: string | null;
  /** A browser-playable copy, present only when the original will not decode. */
  proxy_key: string | null;
  storage_key: string | null;
  external_url: string | null;
  drive_file_id: string | null;
  mime: string;
  size_bytes: number;
  duration_ms: number;
  status: "ready" | "processing" | "failed";
  position: number;
  created_by: string;
  created_at: number;
}

export type TranscribeStatus =
  | "none"
  | "queued"
  | "running"
  | "done"
  | "failed";

export interface Note {
  id: string;
  workspace_id: string;
  project_id: string;
  video_id: string | null;
  author_id: string;
  kind: "voice" | "text";
  audio_key: string | null;
  audio_ms: number;
  text: string;
  anchor_ms: number;
  transcribe_status: TranscribeStatus;
  transcribe_error: string | null;
  stt_provider: string | null;
  created_at: number;
}

export interface TranscriptSegment {
  id: string;
  note_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
}

/** The vocabulary the labeler maps every instruction into. */
export const LABEL_TYPES = [
  "cut",
  "trim",
  "transition",
  "filter",
  "color",
  "text",
  "broll",
  "sfx",
  "music",
  "zoom",
  "speed",
  "caption",
  "blur",
  "keep",
  "note",
] as const;

export type LabelType = (typeof LABEL_TYPES)[number];

export interface Label {
  id: string;
  workspace_id: string;
  project_id: string;
  video_id: string | null;
  note_id: string | null;
  type: LabelType;
  title: string;
  detail: string;
  start_ms: number;
  end_ms: number | null;
  priority: "low" | "normal" | "high";
  status: "open" | "doing" | "done" | "skipped";
  confidence: number;
  origin: "ai" | "manual" | "heuristic";
  /** A voice note, the footage analysis, or an AI recommendation the creator accepted. */
  source: "note" | "analysis" | "recommendation";
  assignee_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  workspace_id: string;
  project_id: string;
  author_id: string | null;
  kind: "text" | "system" | "ai";
  body: string;
  meta: string | null;
  created_at: number;
}

export interface Suggestion {
  id: string;
  project_id: string;
  video_id: string | null;
  payload: string;
  model: string;
  created_at: number;
}

export interface SuggestionItem {
  title: string;
  rationale: string;
  type: LabelType;
  start_ms?: number;
  end_ms?: number;
  priority?: "low" | "normal" | "high";
  effort?: "quick" | "medium" | "involved";
}

export interface SuggestionPayload {
  headline: string;
  read: string;
  items: SuggestionItem[];
  risks: string[];
  gaps: string[];
}

export interface ActivityRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  actor_id: string | null;
  verb: string;
  summary: string;
  meta: string | null;
  created_at: number;
}
