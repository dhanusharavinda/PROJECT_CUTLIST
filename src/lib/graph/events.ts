import { id, many, now, run } from "../db";
import type { Ctx } from "../tenancy";
import type { Role } from "../types";

/**
 * The project's history, append only.
 *
 * Every decision, status change, version and AI run leaves a row here and no
 * row is ever edited or removed by the app. The EditGraph reads the current
 * tables for "what is true now" and this table for "how it got that way", and
 * the two never disagree because the second is only ever added to.
 */

export type ActorKind = "creator" | "editor" | "ai" | "system";

export interface ProjectEvent {
  id: string;
  workspace_id: string;
  project_id: string;
  kind: string;
  actor_kind: ActorKind;
  actor_id: string | null;
  subject_type: string;
  subject_id: string;
  payload: string;
  created_at: number;
}

export interface ProjectEventView extends Omit<ProjectEvent, "payload"> {
  actor_name: string | null;
  payload: Record<string, unknown>;
}

/** Owners and creators act as the creator; editors and viewers as the editor. */
export function actorFor(role: Role): ActorKind {
  return role === "owner" || role === "creator" ? "creator" : "editor";
}

export function recordEvent(
  ctx: Ctx,
  projectId: string,
  event: {
    kind: string;
    actorKind?: ActorKind;
    actorId?: string | null;
    subjectType?: string;
    subjectId?: string;
    payload?: unknown;
  },
): string {
  const eventId = id("evt");
  const actorKind = event.actorKind ?? actorFor(ctx.role);
  run(
    `INSERT INTO project_events
       (id, workspace_id, project_id, kind, actor_kind, actor_id, subject_type, subject_id, payload, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    eventId,
    ctx.workspace.id,
    projectId,
    event.kind.slice(0, 80),
    actorKind,
    event.actorId === undefined ? (actorKind === "ai" || actorKind === "system" ? null : ctx.user.id) : event.actorId,
    (event.subjectType ?? "").slice(0, 40),
    (event.subjectId ?? "").slice(0, 80),
    JSON.stringify(event.payload ?? {}).slice(0, 8000),
    now(),
  );
  return eventId;
}

export function listEvents(
  ctx: Ctx,
  projectId: string,
  options: { limit?: number; since?: number } = {},
): ProjectEventView[] {
  const rows = many<ProjectEvent & { actor_name: string | null }>(
    `SELECT e.*, u.name AS actor_name
       FROM project_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.workspace_id = ? AND e.project_id = ? AND e.created_at > ?
      ORDER BY e.created_at ASC, e.id ASC
      LIMIT ?`,
    ctx.workspace.id,
    projectId,
    options.since ?? 0,
    options.limit ?? 500,
  );

  return rows.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return { ...row, payload };
  });
}
