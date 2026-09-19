import { id, many, now, one, run, tx } from "../db";
import { niche } from "../analysis/presets";
import type { Ctx } from "../tenancy";
import type { Label, Project, Video } from "../types";
import { medianHoldMs, reelDurationMs, slotStarts } from "./time";
import type { ReelSlot, ReelSlotView, ReelView, SlotInput } from "./types";

/**
 * Reads and writes for the reel. Like the rest of the app, every statement pins
 * `workspace_id`, on both sides of a join.
 */

export function listSlots(ctx: Ctx, projectId: string): ReelSlot[] {
  return many<ReelSlot>(
    "SELECT * FROM reel_slots WHERE workspace_id = ? AND project_id = ? ORDER BY idx ASC",
    ctx.workspace.id,
    projectId,
  );
}

/** The clip columns the reel borrows. Null across the row when the clip is gone. */
type SlotRow = ReelSlot & {
  title: string | null;
  source_name: string | null;
  share_url: string | null;
  duration_ms: number | null;
};

export function reelView(ctx: Ctx, projectId: string): ReelView {
  const project = one<Project>(
    "SELECT * FROM projects WHERE id = ? AND workspace_id = ?",
    projectId,
    ctx.workspace.id,
  );

  // A LEFT JOIN, because a deleted clip has to leave its slot behind rather
  // than drop it: see the note on reel_slots.video_id in the schema.
  const rows = many<SlotRow>(
    `SELECT s.*, v.title, v.source_name, v.share_url, v.duration_ms
       FROM reel_slots s
       LEFT JOIN videos v ON v.id = s.video_id AND v.workspace_id = s.workspace_id
      WHERE s.workspace_id = ? AND s.project_id = ?
      ORDER BY s.idx ASC`,
    ctx.workspace.id,
    projectId,
  );

  const starts = slotStarts(rows);

  const slots: ReelSlotView[] = rows.map((row, i) => {
    const missing = row.title === null;
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      video_id: row.video_id,
      idx: row.idx,
      in_ms: row.in_ms,
      out_ms: row.out_ms,
      note: row.note,
      snap: row.snap,
      created_at: row.created_at,
      updated_at: row.updated_at,
      title: row.title,
      // An uploaded clip has no Drive name, so the app title is the nearest
      // thing the editor can actually search for.
      source_name: row.source_name || row.title || "",
      share_url: row.share_url,
      duration_ms: row.duration_ms ?? 0,
      hold_ms: Math.max(0, row.out_ms - row.in_ms),
      reel_start_ms: starts[i],
      frame_idx: missing ? null : slotPoster(ctx, row.video_id, row.in_ms),
      missing,
    };
  });

  const preset = niche(project?.niche);

  return {
    slots,
    total_ms: reelDurationMs(rows),
    shots: slots.length,
    median_hold_ms: medianHoldMs(rows),
    target_ms: preset.shot_ms,
    footage_url: project?.footage_url ?? null,
    music_note: project?.music_note ?? "",
    packet_rev: project?.packet_rev ?? 0,
  };
}

/**
 * Write the reel whole.
 *
 * There is one write path for a reason: `idx` is the array index, so ordering,
 * inserting and removing a slot are all the same operation and no renumbering
 * pass can ever disagree with the client's order. The bump to `packet_rev`
 * belongs in the same transaction, because a handoff built from a half-written
 * reel would carry a version that was never true.
 */
export function replaceSlots(
  ctx: Ctx,
  projectId: string,
  items: SlotInput[],
): ReelView {
  tx(() => {
    run(
      "DELETE FROM reel_slots WHERE workspace_id = ? AND project_id = ?",
      ctx.workspace.id,
      projectId,
    );

    items.forEach((item, idx) => {
      run(
        `INSERT INTO reel_slots
           (id, workspace_id, project_id, video_id, idx, in_ms, out_ms, note, snap, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id("rsl"),
        ctx.workspace.id,
        projectId,
        item.videoId,
        idx,
        item.inMs,
        item.outMs,
        (item.note ?? "").trim().slice(0, 400),
        item.snap ?? "manual",
        now(),
        now(),
      );
    });

    run(
      "UPDATE projects SET packet_rev = packet_rev + 1, updated_at = ? WHERE id = ? AND workspace_id = ?",
      now(),
      projectId,
      ctx.workspace.id,
    );
  });

  return reelView(ctx, projectId);
}

/**
 * A first draft of the reel: every piece of footage, whole, in shelf order.
 *
 * Reference clips are left out because they are reels to imitate, not footage
 * to cut. A clip nobody has measured yet reports `duration_ms` 0 and is skipped
 * rather than seeded as an empty slot: reel time is a running sum, so a
 * zero-length slot would shift every later slot. The count in the returned view
 * is what was actually seeded, so the caller can see the shortfall.
 */
export function seedFromFootage(
  ctx: Ctx,
  projectId: string,
): { reel: ReelView; skipped: number } {
  const clips = many<Video>(
    `SELECT * FROM videos
      WHERE workspace_id = ? AND project_id = ? AND role = 'footage'
      ORDER BY position ASC, created_at ASC`,
    ctx.workspace.id,
    projectId,
  );

  // A browser-reported duration is zero for anything it cannot decode, and an
  // HEVC upload stays at zero until ffprobe reads it, so the measured length
  // wins where there is one. A slot with no length at all cannot exist, because
  // reel time is a running sum and one zero-length slot shifts every later
  // offset, so those clips are left out and counted rather than dropped quietly.
  const measured = new Map(
    many<{ video_id: string; duration_ms: number }>(
      `SELECT video_id, duration_ms FROM analyses
        WHERE workspace_id = ? AND project_id = ? AND duration_ms > 0`,
      ctx.workspace.id,
      projectId,
    ).map((row) => [row.video_id, row.duration_ms]),
  );

  const usable: { videoId: string; inMs: number; outMs: number; snap: "manual" }[] = [];
  let skipped = 0;

  for (const clip of clips) {
    const length = clip.duration_ms > 0 ? clip.duration_ms : (measured.get(clip.id) ?? 0);
    if (length > 0) {
      usable.push({ videoId: clip.id, inMs: 0, outMs: length, snap: "manual" });
    } else {
      skipped += 1;
    }
  }

  return { reel: replaceSlots(ctx, projectId, usable), skipped };
}

/**
 * Which recorded instructions land inside a slot.
 *
 * Derived, never stored. A label is anchored to a clip and a time, and the
 * creator is free to retrim the slot afterwards, so membership has to be worked
 * out on read: a column would go stale the first time an in point moved, and
 * would say nothing at all about the notes recorded before the reel existed.
 *
 * The span is taken literally, unlike `spanOf`, whose implied hold exists to
 * keep a cue on screen for a person and would drag labels into a neighbouring
 * slot here.
 */
export function labelsForSlot(slot: ReelSlotView, labels: Label[]): Label[] {
  return labels.filter((label) => {
    if (label.video_id !== slot.video_id) return false;
    const end = label.end_ms ?? label.start_ms;
    return label.start_ms <= slot.out_ms && end >= slot.in_ms;
  });
}

/** The analysis frame nearest a moment in a clip, for a poster image. */
export function slotPoster(
  ctx: Ctx,
  videoId: string,
  atMs: number,
): number | null {
  const row = one<{ idx: number }>(
    `SELECT idx FROM analysis_frames
      WHERE workspace_id = ? AND video_id = ?
      ORDER BY ABS(at_ms - ?) ASC, idx ASC
      LIMIT 1`,
    ctx.workspace.id,
    videoId,
    atMs,
  );
  return row?.idx ?? null;
}
