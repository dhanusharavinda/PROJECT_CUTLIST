import { id, many, now, one, run, tx } from "../db";
import { removeKey } from "../storage";
import type { Ctx } from "../tenancy";
import type { Video } from "../types";
import type {
  AnalysisPayload,
  AnalysisRow,
  ClipTagRow,
  EditPlanRow,
  PlanPayload,
  ReferenceTemplate,
} from "./types";

/**
 * Reads and writes for everything the analyser produces. Like the rest of the
 * app, every statement pins `workspace_id`.
 */

export interface AnalysisView {
  id: string;
  video_id: string;
  status: AnalysisRow["status"];
  error: string | null;
  engine: string;
  width: number;
  height: number;
  fps: number;
  duration_ms: number;
  has_audio: boolean;
  bpm: number;
  scene_count: number;
  updated_at: number;
  payload: AnalysisPayload | null;
}

export function parsePayload(raw: string | null): AnalysisPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AnalysisPayload;
    return parsed && Array.isArray(parsed.shots) ? parsed : null;
  } catch {
    return null;
  }
}

function view(row: AnalysisRow): AnalysisView {
  return {
    id: row.id,
    video_id: row.video_id,
    status: row.status,
    error: row.error,
    engine: row.engine,
    width: row.width,
    height: row.height,
    fps: row.fps,
    duration_ms: row.duration_ms,
    has_audio: Boolean(row.has_audio),
    bpm: row.bpm,
    scene_count: row.scene_count,
    updated_at: row.updated_at,
    payload: parsePayload(row.payload),
  };
}

export function getAnalysis(ctx: Ctx, videoId: string): AnalysisView | null {
  const row = one<AnalysisRow>(
    "SELECT * FROM analyses WHERE workspace_id = ? AND video_id = ?",
    ctx.workspace.id,
    videoId,
  );
  return row ? view(row) : null;
}

export function listAnalyses(ctx: Ctx, projectId: string): AnalysisView[] {
  return many<AnalysisRow>(
    "SELECT * FROM analyses WHERE workspace_id = ? AND project_id = ? ORDER BY updated_at DESC",
    ctx.workspace.id,
    projectId,
  ).map(view);
}

/** Claim the slot before the work starts, so the UI can show "running". */
export function markRunning(ctx: Ctx, video: Video): AnalysisView {
  const existing = one<AnalysisRow>(
    "SELECT * FROM analyses WHERE workspace_id = ? AND video_id = ?",
    ctx.workspace.id,
    video.id,
  );

  if (existing) {
    run(
      "UPDATE analyses SET status = 'running', error = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?",
      now(),
      existing.id,
      ctx.workspace.id,
    );
  } else {
    run(
      `INSERT INTO analyses (id, workspace_id, project_id, video_id, status, engine, payload, created_at, updated_at)
       VALUES (?,?,?,?,'running','',?,?,?)`,
      id("anl"),
      ctx.workspace.id,
      video.project_id,
      video.id,
      "{}",
      now(),
      now(),
    );
  }

  return getAnalysis(ctx, video.id)!;
}

export function finishAnalysis(
  ctx: Ctx,
  videoId: string,
  data: {
    engine: string;
    width: number;
    height: number;
    fps: number;
    durationMs: number;
    hasAudio: boolean;
    bpm: number;
    sceneCount: number;
    payload: AnalysisPayload;
  },
) {
  run(
    `UPDATE analyses
        SET status = 'done', error = NULL, engine = ?, width = ?, height = ?, fps = ?,
            duration_ms = ?, has_audio = ?, bpm = ?, scene_count = ?, payload = ?, updated_at = ?
      WHERE workspace_id = ? AND video_id = ?`,
    data.engine,
    data.width,
    data.height,
    data.fps,
    data.durationMs,
    data.hasAudio ? 1 : 0,
    data.bpm,
    data.sceneCount,
    JSON.stringify(data.payload),
    now(),
    ctx.workspace.id,
    videoId,
  );
}

export function failAnalysis(ctx: Ctx, videoId: string, message: string) {
  run(
    "UPDATE analyses SET status = 'failed', error = ?, updated_at = ? WHERE workspace_id = ? AND video_id = ?",
    message.slice(0, 400),
    now(),
    ctx.workspace.id,
    videoId,
  );
}

// ── Frames ──────────────────────────────────────────────────────────────────

export interface FrameRow {
  id: string;
  workspace_id: string;
  video_id: string;
  idx: number;
  at_ms: number;
  storage_key: string;
  shot_idx: number;
}

export function listFrames(ctx: Ctx, videoId: string): FrameRow[] {
  return many<FrameRow>(
    "SELECT * FROM analysis_frames WHERE workspace_id = ? AND video_id = ? ORDER BY idx ASC",
    ctx.workspace.id,
    videoId,
  );
}

export function getFrame(ctx: Ctx, videoId: string, idx: number): FrameRow | null {
  return one<FrameRow>(
    "SELECT * FROM analysis_frames WHERE workspace_id = ? AND video_id = ? AND idx = ?",
    ctx.workspace.id,
    videoId,
    idx,
  );
}

/** Replace the frame set, deleting the files the old rows pointed at. */
export async function replaceFrames(
  ctx: Ctx,
  videoId: string,
  frames: { idx: number; at_ms: number; storage_key: string; shot_idx: number }[],
) {
  const stale = listFrames(ctx, videoId).filter(
    (row) => !frames.some((f) => f.storage_key === row.storage_key),
  );

  tx(() => {
    run(
      "DELETE FROM analysis_frames WHERE workspace_id = ? AND video_id = ?",
      ctx.workspace.id,
      videoId,
    );
    for (const frame of frames) {
      run(
        `INSERT INTO analysis_frames (id, workspace_id, video_id, idx, at_ms, storage_key, shot_idx)
         VALUES (?,?,?,?,?,?,?)`,
        id("frm"),
        ctx.workspace.id,
        videoId,
        frame.idx,
        frame.at_ms,
        frame.storage_key,
        frame.shot_idx,
      );
    }
  });

  await Promise.all(
    stale.map((row) => removeKey(row.storage_key).catch(() => undefined)),
  );
}

// ── Tags ────────────────────────────────────────────────────────────────────

export function listTags(ctx: Ctx, videoId: string): ClipTagRow[] {
  return many<ClipTagRow>(
    "SELECT * FROM clip_tags WHERE workspace_id = ? AND video_id = ? ORDER BY kind, tag",
    ctx.workspace.id,
    videoId,
  );
}

export function tagsForWorkspace(ctx: Ctx): ClipTagRow[] {
  return many<ClipTagRow>(
    "SELECT * FROM clip_tags WHERE workspace_id = ? ORDER BY tag",
    ctx.workspace.id,
  );
}

/** Replace one kind of tag (local or ai) without touching the other. */
export function setTags(
  ctx: Ctx,
  videoId: string,
  kind: "local" | "ai",
  tags: { tag: string; confidence?: number }[],
) {
  tx(() => {
    run(
      "DELETE FROM clip_tags WHERE workspace_id = ? AND video_id = ? AND kind = ?",
      ctx.workspace.id,
      videoId,
      kind,
    );
    const seen = new Set<string>();
    for (const entry of tags) {
      const tag = entry.tag.trim().toLowerCase().slice(0, 40);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      run(
        `INSERT INTO clip_tags (id, workspace_id, video_id, tag, kind, confidence, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (video_id, tag) DO UPDATE SET kind = excluded.kind, confidence = excluded.confidence`,
        id("tag"),
        ctx.workspace.id,
        videoId,
        tag,
        kind,
        entry.confidence ?? 1,
        now(),
      );
    }
  });
}

// ── Plans ───────────────────────────────────────────────────────────────────

export interface PlanView {
  id: string;
  video_id: string;
  niche: string;
  origin: "local" | "ai";
  model: string;
  created_at: number;
  payload: PlanPayload | null;
}

function planView(row: EditPlanRow): PlanView {
  let payload: PlanPayload | null = null;
  try {
    payload = JSON.parse(row.payload) as PlanPayload;
  } catch {
    payload = null;
  }
  return {
    id: row.id,
    video_id: row.video_id,
    niche: row.niche,
    origin: row.origin,
    model: row.model,
    created_at: row.created_at,
    payload,
  };
}

export function savePlan(
  ctx: Ctx,
  data: {
    projectId: string;
    videoId: string;
    niche: string;
    origin: "local" | "ai";
    model: string;
    payload: PlanPayload;
  },
): PlanView {
  const planId = id("pln");
  run(
    `INSERT INTO edit_plans (id, workspace_id, project_id, video_id, niche, origin, model, payload, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    planId,
    ctx.workspace.id,
    data.projectId,
    data.videoId,
    data.niche,
    data.origin,
    data.model,
    JSON.stringify(data.payload),
    ctx.user.id,
    now(),
  );

  // Two plans for the same clip is noise; only the newest is ever shown.
  run(
    "DELETE FROM edit_plans WHERE workspace_id = ? AND video_id = ? AND id != ?",
    ctx.workspace.id,
    data.videoId,
    planId,
  );

  return planView(
    one<EditPlanRow>(
      "SELECT * FROM edit_plans WHERE id = ? AND workspace_id = ?",
      planId,
      ctx.workspace.id,
    )!,
  );
}

export function latestPlan(ctx: Ctx, videoId: string): PlanView | null {
  const row = one<EditPlanRow>(
    "SELECT * FROM edit_plans WHERE workspace_id = ? AND video_id = ? ORDER BY created_at DESC LIMIT 1",
    ctx.workspace.id,
    videoId,
  );
  return row ? planView(row) : null;
}

export function listPlans(ctx: Ctx, projectId: string): PlanView[] {
  return many<EditPlanRow>(
    "SELECT * FROM edit_plans WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC",
    ctx.workspace.id,
    projectId,
  ).map(planView);
}

// ── Reference reels ─────────────────────────────────────────────────────────

/** Pull the rhythm out of a reference clip's analysis. */
export function referenceTemplate(
  ctx: Ctx,
  videoId: string,
): ReferenceTemplate | null {
  const video = one<Video>(
    "SELECT * FROM videos WHERE id = ? AND workspace_id = ?",
    videoId,
    ctx.workspace.id,
  );
  const analysis = getAnalysis(ctx, videoId);
  if (!video || !analysis?.payload) return null;

  const payload = analysis.payload;
  const shots = payload.shots;
  if (shots.length === 0) return null;

  const lengths = shots.map((s) => s.end_ms - s.start_ms).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const minutes = payload.duration_ms / 60_000;

  const tolerance = 160;
  const onBeat = payload.beats.length
    ? shots.filter((shot) =>
        payload.beats.some((beat) => Math.abs(beat - shot.start_ms) <= tolerance),
      ).length / shots.length
    : 0;

  return {
    video_id: video.id,
    title: video.title,
    duration_ms: payload.duration_ms,
    shots: shots.length,
    median_shot_ms: median,
    cuts_per_minute: minutes > 0 ? Math.round(shots.length / minutes) : 0,
    bpm: payload.bpm,
    on_beat_pct: Math.round(onBeat * 100),
    brightness:
      Math.round(
        (shots.reduce((a, s) => a + s.brightness, 0) / shots.length) * 100,
      ) / 100,
    saturation:
      Math.round(
        (shots.reduce((a, s) => a + s.saturation, 0) / shots.length) * 100,
      ) / 100,
    orientation: payload.orientation,
  };
}

// ── Clip library ────────────────────────────────────────────────────────────

export interface LibraryClip {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  role: string;
  duration_ms: number;
  created_at: number;
  source: string;
  analysis_status: string | null;
  bpm: number | null;
  scene_count: number | null;
  has_frames: number;
  tags: string[];
}

export function libraryClips(ctx: Ctx): LibraryClip[] {
  const rows = many<Omit<LibraryClip, "tags">>(
    `SELECT v.id, v.title, v.project_id, p.name AS project_name, v.role, v.duration_ms,
            v.created_at, v.source,
            a.status AS analysis_status, a.bpm, a.scene_count,
            (SELECT COUNT(*) FROM analysis_frames f
              WHERE f.video_id = v.id AND f.workspace_id = v.workspace_id) AS has_frames
       FROM videos v
       JOIN projects p ON p.id = v.project_id AND p.workspace_id = v.workspace_id
       LEFT JOIN analyses a ON a.video_id = v.id AND a.workspace_id = v.workspace_id
      WHERE v.workspace_id = ?
      ORDER BY v.created_at DESC`,
    ctx.workspace.id,
  );

  const tags = tagsForWorkspace(ctx);
  const byVideo = new Map<string, string[]>();
  for (const tag of tags) {
    const list = byVideo.get(tag.video_id) ?? [];
    list.push(tag.tag);
    byVideo.set(tag.video_id, list);
  }

  return rows.map((row) => ({ ...row, tags: byVideo.get(row.id) ?? [] }));
}
