import type { VersionSnapshot } from "./versions";

/**
 * What changed between two versions, in plain words.
 *
 * Only what the snapshots actually expose is compared. When a version arrived
 * with no timeline attached, the answer is "unknown", never a guess: an editor
 * reads these lines to learn what the other party did, and an invented line is
 * worse than a missing one.
 */

export type DeltaKind =
  | "removed"
  | "added"
  | "reordered"
  | "shortened"
  | "lengthened"
  | "runtime"
  | "ignored"
  | "unknown";

export interface Delta {
  kind: DeltaKind;
  text: string;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function diffSnapshots(
  previous: VersionSnapshot | null,
  next: VersionSnapshot,
  clipNames: Map<string, string>,
  actor: "Human" | "AI" | "Creator",
): Delta[] {
  const out: Delta[] = [];
  const name = (videoId: string) => clipNames.get(videoId) ?? "a clip";

  if (!previous) {
    return [{ kind: "unknown", text: "First version recorded, nothing earlier to compare against." }];
  }
  if (!next.slots) {
    return [{ kind: "unknown", text: "This version did not carry a timeline, so the changes are unknown." }];
  }
  if (!previous.slots) {
    return [{ kind: "unknown", text: "The earlier version had no timeline, so the changes are unknown." }];
  }

  const before = previous.slots;
  const after = next.slots;

  const beforeIds = new Set(before.map((s) => s.video_id));
  const afterIds = new Set(after.map((s) => s.video_id));

  for (const videoId of beforeIds) {
    if (!afterIds.has(videoId)) out.push({ kind: "removed", text: `${actor} removed ${name(videoId)}.` });
  }
  for (const videoId of afterIds) {
    if (!beforeIds.has(videoId)) out.push({ kind: "added", text: `${actor} added ${name(videoId)}.` });
  }

  // Order, judged only on the clips both versions share.
  const common = [...beforeIds].filter((v) => afterIds.has(v));
  const orderBefore = before.map((s) => s.video_id).filter((v) => common.includes(v)).join("|");
  const orderAfter = after.map((s) => s.video_id).filter((v) => common.includes(v)).join("|");
  if (orderBefore !== orderAfter) out.push({ kind: "reordered", text: `${actor} changed the clip order.` });

  // Holds, matched by clip and nearest in point.
  const used = new Set<number>();
  for (const slot of before) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    after.forEach((candidate, index) => {
      if (used.has(index) || candidate.video_id !== slot.video_id) return;
      const distance = Math.abs(candidate.in_ms - slot.in_ms);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    if (best < 0) continue;
    used.add(best);
    const was = slot.out_ms - slot.in_ms;
    const now = after[best].out_ms - after[best].in_ms;
    if (Math.abs(now - was) > 250) {
      out.push({
        kind: now < was ? "shortened" : "lengthened",
        text: `${actor} ${now < was ? "shortened" : "lengthened"} ${name(slot.video_id)} from ${seconds(was)} to ${seconds(now)}.`,
      });
    }
  }

  if (
    typeof previous.total_ms === "number" &&
    typeof next.total_ms === "number" &&
    Math.abs(previous.total_ms - next.total_ms) > 250
  ) {
    out.push({
      kind: "runtime",
      text: `Runtime went from ${seconds(previous.total_ms)} to ${seconds(next.total_ms)}.`,
    });
  }

  if (out.length === 0) {
    out.push({ kind: "unknown", text: "No timeline differences were measurable between these versions." });
  }
  return out;
}

/** Approved suggestions that never became instructions: the other party passed on them. */
export function ignoredLine(approvedNotConverted: number, actor: "Human" | "AI"): Delta | null {
  if (approvedNotConverted <= 0) return null;
  return {
    kind: "ignored",
    text: `${actor} did not act on ${approvedNotConverted} approved suggestion${approvedNotConverted === 1 ? "" : "s"}.`,
  };
}
