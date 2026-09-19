import { id, many, now, run } from "./db";
import { bus, type BusEvent } from "./bus";

export function logActivity(params: {
  workspaceId: string;
  projectId?: string | null;
  actorId?: string | null;
  verb: string;
  summary: string;
  meta?: unknown;
}) {
  run(
    "INSERT INTO activity (id, workspace_id, project_id, actor_id, verb, summary, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id("act"),
    params.workspaceId,
    params.projectId ?? null,
    params.actorId ?? null,
    params.verb,
    params.summary,
    params.meta ? JSON.stringify(params.meta) : null,
    now(),
  );
}

export function recentActivity(workspaceId: string, limit = 25) {
  return many<{
    id: string;
    project_id: string | null;
    project_name: string | null;
    actor_name: string | null;
    verb: string;
    summary: string;
    created_at: number;
  }>(
    `SELECT a.id, a.project_id, p.name AS project_name, u.name AS actor_name,
            a.verb, a.summary, a.created_at
       FROM activity a
       LEFT JOIN projects p ON p.id = a.project_id AND p.workspace_id = a.workspace_id
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.workspace_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?`,
    workspaceId,
    limit,
  );
}

/** Log + broadcast in one call; the two always happen together. */
export function emit(
  workspaceId: string,
  event: BusEvent,
  activity?: { actorId?: string | null; verb: string; summary: string },
) {
  if (activity) {
    logActivity({
      workspaceId,
      projectId: event.projectId,
      actorId: activity.actorId,
      verb: activity.verb,
      summary: activity.summary,
    });
  }
  bus.publish(workspaceId, event);
}
