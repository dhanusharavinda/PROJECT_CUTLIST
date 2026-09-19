import { id, many, now, one, run } from "../db";
import type { Ctx } from "../tenancy";
import { badRequest, notFound } from "../tenancy";
import { recordEvent, type ActorKind } from "./events";

/**
 * Project versions: V1 AI draft, V2 human edit, V3 creator revision.
 *
 * A version is a named moment, not a copy of anything. It records who made
 * it, what it says, and a small snapshot of the reel at the time so a later
 * version can be compared against it. The interface reads these to answer
 * "what did the AI do, what did the human do, what did the creator ask for".
 */

export const VERSION_KINDS = [
  "ai_draft",
  "human_edit",
  "creator_revision",
  "ai_revision",
  "human_final",
] as const;

export type VersionKind = (typeof VERSION_KINDS)[number];

export const VERSION_LABELS: Record<VersionKind, string> = {
  ai_draft: "AI draft",
  human_edit: "Human edit",
  creator_revision: "Creator revision",
  ai_revision: "AI revision",
  human_final: "Human final",
};

export type Approval = "pending" | "approved" | "changes_requested";

export interface ProjectVersion {
  id: string;
  workspace_id: string;
  project_id: string;
  number: number;
  kind: VersionKind;
  title: string;
  summary: string;
  actor_kind: ActorKind;
  actor_id: string | null;
  video_id: string | null;
  approval: Approval;
  payload: string;
  created_at: number;
}

export interface VersionSnapshot {
  slots?: { video_id: string; in_ms: number; out_ms: number }[];
  total_ms?: number;
  open_instructions?: number;
  proposed_recommendations?: number;
  /** Deltas against the previous version, in plain words. Empty when unknown. */
  changes?: string[];
  /** Instruction ids the editor marked done, when they told us. */
  completed?: string[];
  unresolved?: string[];
}

export interface ProjectVersionView extends Omit<ProjectVersion, "payload"> {
  actor_name: string | null;
  label: string;
  payload: VersionSnapshot;
}

function view(row: ProjectVersion & { actor_name: string | null }): ProjectVersionView {
  let payload: VersionSnapshot = {};
  try {
    payload = JSON.parse(row.payload) as VersionSnapshot;
  } catch {
    payload = {};
  }
  return { ...row, payload, label: `V${row.number} ${VERSION_LABELS[row.kind] ?? row.kind}` };
}

export function listProjectVersions(ctx: Ctx, projectId: string): ProjectVersionView[] {
  return many<ProjectVersion & { actor_name: string | null }>(
    `SELECT v.*, u.name AS actor_name
       FROM project_versions v
       LEFT JOIN users u ON u.id = v.actor_id
      WHERE v.workspace_id = ? AND v.project_id = ?
      ORDER BY v.number ASC`,
    ctx.workspace.id,
    projectId,
  ).map(view);
}

export function getProjectVersion(ctx: Ctx, versionId: string): ProjectVersionView {
  const row = one<ProjectVersion & { actor_name: string | null }>(
    `SELECT v.*, u.name AS actor_name
       FROM project_versions v
       LEFT JOIN users u ON u.id = v.actor_id
      WHERE v.id = ? AND v.workspace_id = ?`,
    versionId,
    ctx.workspace.id,
  );
  if (!row) throw notFound("Version not found in this workspace.");
  return view(row);
}

export function createProjectVersion(
  ctx: Ctx,
  projectId: string,
  input: {
    kind: VersionKind;
    title?: string;
    summary?: string;
    actorKind: ActorKind;
    actorId?: string | null;
    videoId?: string | null;
    payload?: VersionSnapshot;
  },
): ProjectVersionView {
  const next =
    (one<{ n: number }>(
      "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM project_versions WHERE workspace_id = ? AND project_id = ?",
      ctx.workspace.id,
      projectId,
    )?.n ?? 1) | 0;

  const versionId = id("ver");
  run(
    `INSERT INTO project_versions
       (id, workspace_id, project_id, number, kind, title, summary, actor_kind, actor_id, video_id, approval, payload, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    versionId,
    ctx.workspace.id,
    projectId,
    next,
    input.kind,
    (input.title ?? VERSION_LABELS[input.kind]).slice(0, 120),
    (input.summary ?? "").slice(0, 2000),
    input.actorKind,
    input.actorId === undefined
      ? input.actorKind === "ai" || input.actorKind === "system"
        ? null
        : ctx.user.id
      : input.actorId,
    input.videoId ?? null,
    JSON.stringify(input.payload ?? {}),
    now(),
  );

  recordEvent(ctx, projectId, {
    kind: "version.created",
    actorKind: input.actorKind,
    actorId: input.actorId,
    subjectType: "version",
    subjectId: versionId,
    payload: { number: next, kind: input.kind, title: input.title ?? VERSION_LABELS[input.kind] },
  });

  return getProjectVersion(ctx, versionId);
}

export function setApproval(
  ctx: Ctx,
  versionId: string,
  approval: Approval,
  note = "",
): ProjectVersionView {
  const current = getProjectVersion(ctx, versionId);
  if (current.approval === approval) return current;
  if (!["pending", "approved", "changes_requested"].includes(approval)) {
    throw badRequest("Unknown approval state.");
  }
  run(
    "UPDATE project_versions SET approval = ? WHERE id = ? AND workspace_id = ?",
    approval,
    versionId,
    ctx.workspace.id,
  );
  recordEvent(ctx, current.project_id, {
    kind: `version.${approval}`,
    subjectType: "version",
    subjectId: versionId,
    payload: { number: current.number, note },
  });
  return getProjectVersion(ctx, versionId);
}
