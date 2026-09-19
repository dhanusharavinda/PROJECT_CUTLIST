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
