import { id, many, now, one, run, tx } from "../db";
import type { Ctx } from "../tenancy";
import { badRequest, notFound } from "../tenancy";
import { LABEL_TYPES, type Label, type LabelType } from "../types";
import type { PlanItem, PlanPayload } from "../analysis/types";
import { recordEvent, type ActorKind } from "./events";

/**
 * What the AI proposes, as rows with a life of their own.
 *
 * A recommendation and an instruction are different things. A label is a
 * decision the creator made. A recommendation is something a model suggested,
 * and it stays a suggestion until the creator approves, rejects, changes or
 * converts it. Nothing here ever writes to the cut list on its own.
 *
 * History is kept by superseding, never by overwriting: changing a
 * recommendation creates a new row that points at the old one.
 */

export const RECOMMENDATION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "modified",
  "converted",
  "superseded",
  "needs_review",
] as const;

export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

/** The label vocabulary plus the things only a director says. */
export const RECOMMENDATION_TYPES = [
  ...LABEL_TYPES,
  "hook",
  "order",
  "remove",
  "pacing",
  "narrative",
  "inconsistency",
  "missing",
  "conflict",
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export interface Recommendation {
  id: string;
  workspace_id: string;
  project_id: string;
  video_id: string | null;
  type: RecommendationType;
  title: string;
  detail: string;
  rationale: string;
  start_ms: number | null;
  end_ms: number | null;
  confidence: number;
  priority: "low" | "normal" | "high";
  source: string;
  status: RecommendationStatus;
  /** Which part of the edit it belongs to: hook, body, close, audio, text, whole. */
  scope: string;
  label_id: string | null;
  supersedes_id: string | null;
  run_id: string | null;
  created_at: number;
  updated_at: number;
}

/** A change the creator can legitimately ask for on a status. */
const TRANSITIONS: Record<RecommendationStatus, RecommendationStatus[]> = {
  proposed: ["approved", "rejected", "needs_review"],
  needs_review: ["approved", "rejected", "proposed"],
  approved: ["rejected", "proposed"],
  rejected: ["proposed"],
  modified: ["approved", "rejected"],
  converted: [],
  superseded: [],
};

export function getRecommendation(ctx: Ctx, recommendationId: string): Recommendation {
  const row = one<Recommendation>(
    "SELECT * FROM recommendations WHERE id = ? AND workspace_id = ?",
    recommendationId,
    ctx.workspace.id,
  );
  if (!row) throw notFound("Recommendation not found in this workspace.");
  return row;
}

export function listRecommendations(
  ctx: Ctx,
  projectId: string,
  options: { videoId?: string | null; live?: boolean } = {},
): Recommendation[] {
  const clauses = ["workspace_id = ?", "project_id = ?"];
  const params: (string | number)[] = [ctx.workspace.id, projectId];
  if (options.videoId !== undefined) {
    clauses.push(options.videoId === null ? "video_id IS NULL" : "video_id = ?");
    if (options.videoId !== null) params.push(options.videoId);
  }
  // "Live" is everything still on the table: not replaced, not already turned
  // into an instruction.
  if (options.live) clauses.push("status NOT IN ('superseded', 'converted')");
  return many<Recommendation>(
    `SELECT * FROM recommendations WHERE ${clauses.join(" AND ")}
      ORDER BY COALESCE(start_ms, 0) ASC, created_at ASC`,
    ...params,
  );
}

/** Where in the edit a moment falls, so a revision can be scoped to a part. */
export function scopeFor(startMs: number | null, durationMs: number, type: string): string {
  if (type === "music" || type === "sfx") return "audio";
  if (type === "text" || type === "caption") return "text";
  if (startMs === null || durationMs <= 0) return "whole";
  const ratio = startMs / durationMs;
  if (ratio < 0.15) return "hook";
  if (ratio > 0.85) return "close";
  return "body";
}

/**
 * A plan becomes recommendations.
 *
 * Earlier proposals for the same clip from the same kind of source are marked
 * superseded rather than deleted, so a creator who rejected something last week
 * is not shown it again as new, and the record of what was proposed survives.
 */
export function proposeFromPlan(
  ctx: Ctx,
  projectId: string,
  videoId: string,
  plan: PlanPayload,
  options: { source: string; runId?: string | null; durationMs: number },
): Recommendation[] {
  const previous = listRecommendations(ctx, projectId, { videoId, live: true });
  const stamp = now();

  const created: string[] = [];
  tx(() => {
    for (const old of previous) {
      if (old.status !== "proposed") continue;
      run(
        "UPDATE recommendations SET status = 'superseded', updated_at = ? WHERE id = ? AND workspace_id = ?",
        stamp,
        old.id,
        ctx.workspace.id,
      );
    }

    for (const item of plan.items) {
      // The creator already said no to this exact suggestion; do not re-propose it.
      const rejectedBefore = previous.some(
        (old) =>
          old.status === "rejected" &&
          old.type === item.type &&
          Math.abs((old.start_ms ?? 0) - item.start_ms) < 500 &&
          old.title === item.title,
      );
      if (rejectedBefore) continue;

      const recommendationId = id("rec");
      created.push(recommendationId);
      run(
        `INSERT INTO recommendations
           (id, workspace_id, project_id, video_id, type, title, detail, rationale, start_ms, end_ms,
            confidence, priority, source, status, scope, label_id, supersedes_id, run_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed',?,NULL,NULL,?,?,?)`,
        recommendationId,
        ctx.workspace.id,
        projectId,
        videoId,
        item.type,
        item.title.slice(0, 200),
        "",
        item.detail.slice(0, 2000),
        item.start_ms,
        item.end_ms,
        item.confidence,
        item.priority,
        item.source === "ai" ? options.source : "local",
        scopeFor(item.start_ms, options.durationMs, item.type),
        options.runId ?? null,
        stamp,
        stamp,
      );
    }
  });

  recordEvent(ctx, projectId, {
    kind: "recommendations.proposed",
    actorKind: "ai",
    subjectType: "video",
    subjectId: videoId,
    payload: { count: created.length, superseded: previous.filter((p) => p.status === "proposed").length, source: options.source },
  });

  return listRecommendations(ctx, projectId, { videoId, live: true });
}

export interface ProposedItem {
  type: RecommendationType;
  video_id: string | null;
  title: string;
  detail: string;
  rationale: string;
  start_ms: number | null;
  end_ms: number | null;
  confidence: number;
  priority: "low" | "normal" | "high";
  scope: string;
}

/**
 * The director's proposals, at project level.
 *
 * Only proposals still marked "proposed" and inside the given scopes are
 * superseded; anything the creator approved, changed or sent for review is
 * left exactly as it was, and anything they rejected is never re-proposed.
 * Passing no scopes means the whole project was in play.
 */
export function proposeMany(
  ctx: Ctx,
  projectId: string,
  items: ProposedItem[],
  options: { source: string; runId: string | null; scopes: string[] | null },
): Recommendation[] {
  const live = listRecommendations(ctx, projectId, { live: true });
  const inScope = (scope: string) => options.scopes === null || options.scopes.includes(scope);
  const stamp = now();
  const created: string[] = [];

  tx(() => {
    for (const old of live) {
      if (old.status !== "proposed" || !inScope(old.scope)) continue;
      run(
        "UPDATE recommendations SET status = 'superseded', updated_at = ? WHERE id = ? AND workspace_id = ?",
        stamp,
        old.id,
        ctx.workspace.id,
      );
    }

    for (const item of items) {
      if (!inScope(item.scope)) continue;
      const rejectedBefore = live.some(
        (old) =>
          old.status === "rejected" &&
          old.type === item.type &&
          Math.abs((old.start_ms ?? 0) - (item.start_ms ?? 0)) < 500 &&
          old.title.toLowerCase() === item.title.toLowerCase(),
      );
      if (rejectedBefore) continue;

      const recommendationId = id("rec");
      created.push(recommendationId);
      run(
        `INSERT INTO recommendations
           (id, workspace_id, project_id, video_id, type, title, detail, rationale, start_ms, end_ms,
            confidence, priority, source, status, scope, label_id, supersedes_id, run_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed',?,NULL,NULL,?,?,?)`,
        recommendationId,
        ctx.workspace.id,
        projectId,
        item.video_id,
        item.type,
        item.title.slice(0, 200),
        item.detail.slice(0, 2000),
        item.rationale.slice(0, 2000),
        item.start_ms,
        item.end_ms,
        item.confidence,
        item.priority,
        options.source,
        item.scope,
        options.runId,
        stamp,
        stamp,
      );
    }
  });

  recordEvent(ctx, projectId, {
    kind: "recommendations.proposed",
    actorKind: "ai",
    subjectType: "project",
    subjectId: projectId,
    payload: {
      count: created.length,
      scopes: options.scopes ?? ["whole"],
      source: options.source,
      run_id: options.runId,
    },
  });

  return listRecommendations(ctx, projectId, { live: true });
}

export function setStatus(
  ctx: Ctx,
  recommendationId: string,
  next: RecommendationStatus,
  options: { actorKind?: ActorKind; reason?: string } = {},
): Recommendation {
  const current = getRecommendation(ctx, recommendationId);
  if (!TRANSITIONS[current.status].includes(next)) {
    throw badRequest(
      `A ${current.status} recommendation cannot become ${next}.`,
    );
  }
  run(
    "UPDATE recommendations SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    next,
    now(),
    recommendationId,
    ctx.workspace.id,
  );
  recordEvent(ctx, current.project_id, {
    kind: `recommendation.${next}`,
    actorKind: options.actorKind,
    subjectType: "recommendation",
    subjectId: recommendationId,
    payload: { from: current.status, reason: options.reason ?? "", title: current.title },
  });
  return getRecommendation(ctx, recommendationId);
}

/** The creator changes a suggestion. The original stays, superseded. */
export function modify(
  ctx: Ctx,
  recommendationId: string,
  changes: {
    title?: string;
    detail?: string;
    type?: RecommendationType;
    startMs?: number | null;
    endMs?: number | null;
    priority?: "low" | "normal" | "high";
  },
): Recommendation {
  const current = getRecommendation(ctx, recommendationId);
  if (current.status === "superseded" || current.status === "converted") {
    throw badRequest("That recommendation has already been replaced or accepted.");
  }

  const nextId = id("rec");
  const stamp = now();
  tx(() => {
    run(
      "UPDATE recommendations SET status = 'superseded', updated_at = ? WHERE id = ? AND workspace_id = ?",
      stamp,
      recommendationId,
      ctx.workspace.id,
    );
    run(
      `INSERT INTO recommendations
         (id, workspace_id, project_id, video_id, type, title, detail, rationale, start_ms, end_ms,
          confidence, priority, source, status, scope, label_id, supersedes_id, run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'modified',?,NULL,?,?,?,?)`,
      nextId,
      ctx.workspace.id,
      current.project_id,
      current.video_id,
      changes.type ?? current.type,
      (changes.title ?? current.title).slice(0, 200),
      (changes.detail ?? current.detail).slice(0, 2000),
      current.rationale,
      changes.startMs === undefined ? current.start_ms : changes.startMs,
      changes.endMs === undefined ? current.end_ms : changes.endMs,
      current.confidence,
      changes.priority ?? current.priority,
      `${current.source}+creator`,
      current.scope,
      recommendationId,
      current.run_id,
      stamp,
      stamp,
    );
  });

  recordEvent(ctx, current.project_id, {
    kind: "recommendation.modified",
    subjectType: "recommendation",
    subjectId: nextId,
    payload: { from: recommendationId, changes },
  });

  return getRecommendation(ctx, nextId);
}

/**
 * The creator turns a suggestion into an instruction. This is the only path
 * from a recommendation to the cut list, and it is always a person pressing it.
 */
export function convertToInstruction(ctx: Ctx, recommendationId: string): Label {
  const current = getRecommendation(ctx, recommendationId);
  if (current.status === "converted" && current.label_id) {
    const existing = one<Label>(
      "SELECT * FROM labels WHERE id = ? AND workspace_id = ?",
      current.label_id,
      ctx.workspace.id,
    );
    if (existing) return existing;
  }
  if (current.status === "superseded") {
    throw badRequest("That recommendation was replaced. Convert the newer one.");
  }

  // Director-only types have no cut list vocabulary; they land as notes so the
  // editor still sees them at the right moment.
  const labelType: LabelType = (LABEL_TYPES as readonly string[]).includes(current.type)
    ? (current.type as LabelType)
    : "note";

  const labelId = id("lab");
  const stamp = now();
  tx(() => {
    run(
      `INSERT INTO labels
         (id, workspace_id, project_id, video_id, note_id, type, title, detail,
          start_ms, end_ms, priority, status, confidence, origin, source, assignee_id,
          created_at, updated_at)
       VALUES (?,?,?,?,NULL,?,?,?,?,?,?,'open',?,?,'recommendation',NULL,?,?)`,
      labelId,
      ctx.workspace.id,
      current.project_id,
      current.video_id,
      labelType,
      current.title.slice(0, 200),
      (current.detail || current.rationale).slice(0, 2000),
      current.start_ms ?? 0,
      current.end_ms,
      current.priority,
      current.confidence,
      current.source.startsWith("local") ? "heuristic" : "ai",
      stamp,
      stamp,
    );
    run(
      "UPDATE recommendations SET status = 'converted', label_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
      labelId,
      stamp,
      recommendationId,
      ctx.workspace.id,
    );
  });

  recordEvent(ctx, current.project_id, {
    kind: "recommendation.converted",
    subjectType: "recommendation",
    subjectId: recommendationId,
    payload: { label_id: labelId, title: current.title },
  });

  return one<Label>("SELECT * FROM labels WHERE id = ? AND workspace_id = ?", labelId, ctx.workspace.id)!;
}

/** The plan item shape the existing Plan panel already renders. */
export function asPlanItem(rec: Recommendation): PlanItem & { status: RecommendationStatus; recommendation_id: string } {
  return {
    id: rec.id,
    recommendation_id: rec.id,
    type: ((LABEL_TYPES as readonly string[]).includes(rec.type) ? rec.type : "note") as LabelType,
    title: rec.title,
    detail: rec.detail || rec.rationale,
    start_ms: rec.start_ms ?? 0,
    end_ms: rec.end_ms,
    priority: rec.priority,
    confidence: rec.confidence,
    source: rec.source.startsWith("local") ? "local" : "ai",
    status: rec.status,
  };
}
