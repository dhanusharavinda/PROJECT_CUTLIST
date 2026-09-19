import type { Label } from "../types";

/**
 * When an instruction counts as "now".
 *
 * The playhead position the UI knows about comes from the video element's
 * timeupdate event, which fires roughly four times a second, and playback runs
 * at up to 2x. An exact comparison would therefore skip markers silently, so
 * every window here is deliberately generous at the edges.
 */

/** Grace either side of a span, to survive a 4 Hz clock at 2x speed. */
export const EDGE_MS = 200;
/** How near a shot boundary a dragged point has to be to be pulled onto it. */
export const SNAP_MS = 120;
/** An instruction with no end still holds the cue for this long. */
export const MIN_HOLD_MS = 1500;
/** How long the cue lingers after the playhead leaves the span. */
export const LINGER_MS = 900;

const RANK: Record<Label["priority"], number> = { high: 0, normal: 1, low: 2 };

export interface Span {
  start_ms: number;
  end_ms: number;
}

/** A label's real span. Most heuristic labels carry no end, so one is implied. */
export function spanOf(label: Pick<Label, "start_ms" | "end_ms">): Span {
  const start = Math.max(0, Math.round(label.start_ms));
  const end =
    label.end_ms !== null && label.end_ms > start
      ? Math.round(label.end_ms)
      : start + MIN_HOLD_MS;
  return { start_ms: start, end_ms: end };
}

export function containsMs(
  label: Pick<Label, "start_ms" | "end_ms">,
  ms: number,
  edge = EDGE_MS,
): boolean {
  const span = spanOf(label);
  return ms >= span.start_ms - edge && ms <= span.end_ms + edge;
}

/**
 * Every instruction that applies at this moment, most important first.
 * Skipped instructions are excluded: the creator cancelled them.
 */
export function activeAt(labels: Label[], currentMs: number): Label[] {
  return labels
    .filter((label) => label.status !== "skipped" && containsMs(label, currentMs))
    .sort(
      (a, b) =>
        RANK[a.priority] - RANK[b.priority] ||
        a.start_ms - b.start_ms ||
        a.id.localeCompare(b.id),
    );
}

/** The instruction nearest a position, for a hover readout. */
export function nearestAt(
  labels: Label[],
  ms: number,
  toleranceMs: number,
): Label | null {
  let best: Label | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const label of labels) {
    if (label.status === "skipped") continue;
    const span = spanOf(label);
    const distance =
      ms < span.start_ms
        ? span.start_ms - ms
        : ms > span.end_ms
          ? ms - span.end_ms
          : 0;
    if (distance <= toleranceMs && distance < bestDistance) {
      best = label;
      bestDistance = distance;
    }
  }
  return best;
}

// ── Reel maths ──────────────────────────────────────────────────────────────

/** Just enough of a slot to measure it. */
export interface Hold {
  in_ms: number;
  out_ms: number;
}

/**
 * A hold can never be negative here.
 *
 * The API rejects out <= in, but these functions also run over slots read back
 * from the database, where a clip that was re-measured shorter can leave the
 * pair the wrong way round. Clamping keeps a bad row from dragging the running
 * offsets of every later slot backwards.
 */
function holdOf(slot: Hold): number {
  return Math.max(0, Math.round(slot.out_ms - slot.in_ms));
}

/** Where each slot starts inside the finished reel, in array order. */
export function slotStarts(slots: Hold[]): number[] {
  let running = 0;
  return slots.map((slot) => {
    const start = running;
    running += holdOf(slot);
    return start;
  });
}

export function reelDurationMs(slots: Hold[]): number {
  return slots.reduce((total, slot) => total + holdOf(slot), 0);
}

/** The typical hold, to compare against the niche's target. */
export function medianHoldMs(slots: Hold[]): number {
  if (slots.length === 0) return 0;
  const holds = slots.map(holdOf).sort((a, b) => a - b);
  const mid = Math.floor(holds.length / 2);
  return holds.length % 2 === 1
    ? holds[mid]
    : Math.round((holds[mid - 1] + holds[mid]) / 2);
}

/**
 * Pull a hand-placed point onto the nearest shot boundary.
 *
 * A drag over a timeline a few hundred pixels wide lands tens of milliseconds
 * off whatever it was aimed at, so a cut meant for a scene change misses it.
 * Outside the tolerance the point is left exactly where it was put, because a
 * deliberate cut in the middle of a shot has to stay possible.
 */
export function snapToShot(
  ms: number,
  shotStarts: number[],
  toleranceMs = SNAP_MS,
): { ms: number; snapped: boolean } {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const start of shotStarts) {
    const distance = Math.abs(start - ms);
    if (distance < bestDistance) {
      best = start;
      bestDistance = distance;
    }
  }

  return bestDistance <= toleranceMs
    ? { ms: Math.round(best), snapped: true }
    : { ms: Math.round(ms), snapped: false };
}
