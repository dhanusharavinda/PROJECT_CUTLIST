import type { LabelType } from "../types";

/** One detected shot: the span between two scene changes. */
export interface Shot {
  idx: number;
  start_ms: number;
  end_ms: number;
  /** Mean frame-to-frame change, 0 (locked off) to 1 (chaos). */
  motion: number;
  /** Highest single frame-to-frame change inside the shot. */
  motion_peak: number;
  brightness: number;
  saturation: number;
  hue: number;
  palette: string[];
  /** Low, even motion: usable for masking, freeze frames and clone effects. */
  stable: boolean;
  frame_idx: number | null;
  /** Derived from the numbers by intel.ts. Optional so older payloads still load. */
  camera?: Camera;
  /** How well this shot would open a reel, 0 to 1. */
  hook_score?: number;
  /** An earlier shot this one repeats, or null. */
  duplicate_of?: number | null;
  /** Why the shot is weak, or null when it is fine. */
  weak?: string | null;
  /** Moving picture with nobody talking over it: something to cut away to. */
  broll?: boolean;
  /** What a model saw in the sampled frame, when the enrich pass has run. */
  intel?: ShotIntel | null;
}

/** How much the picture moves, in words an editor uses. */
export type Camera = "static" | "gentle" | "moving" | "fast";

/** What only eyes can tell: filled by the model pass, never by arithmetic. */
export interface ShotIntel {
  subject: "none" | "person" | "people" | "object" | "scene";
  face: "none" | "partial" | "clear";
  framing: "wide" | "medium" | "close_up" | "extreme_close_up" | "unknown";
  composition: string;
  quality: "poor" | "ok" | "good";
  /** A screen, a document, a bystander's face: something a creator usually hides. */
  blur_candidate: boolean;
  notes: string[];
}

/** One shot as an outside agent reads it. Built by intel.ts shotRecord. */
export interface ShotRecord {
  shot_id: string;
  source_clip: string;
  start: number;
  end: number;
  movement: Camera;
  composition: string;
  subject_visibility: "none" | "weak" | "strong" | "unknown";
  hook_score: number;
  notes: string[];
}

export interface Range {
  start_ms: number;
  end_ms: number;
}

export interface ClipSpeech {
  text: string;
  provider: string;
  segments: Range[];
  lines: { start_ms: number; end_ms: number; text: string }[];
}

export type Orientation = "portrait" | "landscape" | "square";

export interface AnalysisPayload {
  version: number;
  orientation: Orientation;
  width: number;
  height: number;
  fps: number;
  duration_ms: number;
  has_audio: boolean;
  shots: Shot[];
  /** Beat times in ms. Empty when the audio is speech rather than music. */
  beats: number[];
  bpm: number;
  beat_confidence: number;
  /** Big energy jumps: where a track opens up. */
  drops: number[];
  /** One energy reading per second, 0 to 1. */
  energy: number[];
  silences: Range[];
  speech: Range[];
  loudness_db: number;
  frames: { idx: number; at_ms: number }[];
  speech_text: ClipSpeech | null;
  warnings: string[];
  /** Set once the model has read the frames. */
  enriched?: { at: number; model: string; frames: number } | null;
}

export interface AnalysisRow {
  id: string;
  workspace_id: string;
  project_id: string;
  video_id: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  engine: string;
  width: number;
  height: number;
  fps: number;
  duration_ms: number;
  has_audio: number;
  bpm: number;
  scene_count: number;
  payload: string;
  created_at: number;
  updated_at: number;
}

export interface ClipTagRow {
  id: string;
  workspace_id: string;
  video_id: string;
  tag: string;
  kind: "local" | "ai";
  confidence: number;
  created_at: number;
}

export type NicheId = "gym" | "aesthetic" | "surreal" | "vlog" | "general";

export interface PlanItem {
  id: string;
  type: LabelType;
  title: string;
  detail: string;
  start_ms: number;
  end_ms: number | null;
  priority: "low" | "normal" | "high";
  confidence: number;
  source: "local" | "ai";
}

export interface PlanPayload {
  niche: NicheId;
  headline: string;
  read: string;
  hook: { score: number; verdict: string; advice: string };
  rhythm: {
    shots: number;
    median_shot_ms: number;
    target_ms: [number, number];
    on_beat_pct: number;
    verdict: string;
  };
  items: PlanItem[];
  captions: string[];
  hashtags: string[];
  overlays: string[];
  music: string;
  safe_zone: string[];
  cover_frame_ms: number | null;
  reference: string | null;
  origin: "local" | "ai";
  model: string;
}

export interface EditPlanRow {
  id: string;
  workspace_id: string;
  project_id: string;
  video_id: string;
  niche: string;
  origin: "local" | "ai";
  model: string;
  payload: string;
  created_by: string | null;
  created_at: number;
}

/** The rhythm of a reel you want to imitate, pulled out of its analysis. */
export interface ReferenceTemplate {
  video_id: string;
  title: string;
  duration_ms: number;
  shots: number;
  median_shot_ms: number;
  cuts_per_minute: number;
  bpm: number;
  on_beat_pct: number;
  brightness: number;
  saturation: number;
  orientation: Orientation;
}
