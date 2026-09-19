import type { Ctx } from "../tenancy";
import { listLabels, listVideos } from "../queries";
import { reelView } from "../reel/store";
import { listRecommendations } from "./recommendations";
import { listProjectVersions, type VersionSnapshot } from "./versions";
import { diffSnapshots, ignoredLine } from "./diff";

/**
 * What a version remembers, and what changed since the last one.
 *
 * Every path that records a version (the History tab, a connector syncing
 * back, the director's first draft) goes through here, so the measured diff
 * is never skipped and the counts always mean the same thing.
 */

export type SnapshotSlot = { video_id: string; in_ms: number; out_ms: number };

export function versionSnapshot(
  ctx: Ctx,
  projectId: string,
  actorKind: "ai" | "creator" | "editor" | "viewer" | string,
  input: {
    /** The timeline as the tool reports it, when it can; the reel otherwise. */
    slots?: SnapshotSlot[];
    completed?: string[];
    unresolved?: string[];
    changes?: string[];
  } = {},
): VersionSnapshot {
  const reel = reelView(ctx, projectId);
  const labels = listLabels(ctx, projectId);
  const recs = listRecommendations(ctx, projectId, { live: true });

  const slots = input.slots ?? reel.slots.map((s) => ({ video_id: s.video_id, in_ms: s.in_ms, out_ms: s.out_ms }));
  const total_ms = input.slots
    ? input.slots.reduce((t, s) => t + Math.max(0, s.out_ms - s.in_ms), 0)
    : reel.total_ms;

  // What changed is measured against the previous version, never invented.
  // Anything the person wrote themselves comes first; the measured lines follow.
  const previous = listProjectVersions(ctx, projectId).at(-1) ?? null;
  const names = new Map(listVideos(ctx, projectId).map((v) => [v.id, v.source_name || v.title]));
  const who = actorKind === "ai" ? "AI" : actorKind === "creator" ? "Creator" : "Human";
  const measured = diffSnapshots(previous?.payload ?? null, { slots, total_ms }, names, who).map((d) => d.text);
  const ignored =
    who === "Human" || who === "AI"
      ? ignoredLine(recs.filter((r) => r.status === "approved").length, who)
      : null;
  const changes = [...(input.changes ?? []), ...measured, ...(ignored ? [ignored.text] : [])].filter(
    (line, index, all) => all.indexOf(line) === index,
  );

  return {
    slots,
    total_ms,
    open_instructions: labels.filter((l) => l.status === "open" || l.status === "doing").length,
    proposed_recommendations: recs.filter((r) => r.status === "proposed").length,
    completed: input.completed ?? [],
    unresolved: input.unresolved ?? [],
    changes,
  };
}
