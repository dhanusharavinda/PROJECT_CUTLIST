import { EventEmitter } from "node:events";

export type BusEvent =
  | { type: "message"; projectId: string; payload: unknown }
  | { type: "note"; projectId: string; payload: unknown }
  | { type: "label"; projectId: string; payload: unknown }
  | { type: "video"; projectId: string; payload: unknown }
  | { type: "brief"; projectId: string; payload: unknown }
  | { type: "suggestion"; projectId: string; payload: unknown }
  | { type: "reel"; projectId: string; payload: unknown }
  | { type: "presence"; projectId: string; payload: unknown };

/**
 * Realtime fan-out for the shared project space.
 *
 * One emitter per process, keyed by `workspaceId:projectId` so a subscriber can
 * never be attached to a channel outside its own workspace. Single-process by
 * design; swap this module for Redis pub/sub to run more than one instance.
 */
class Bus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  private channel(workspaceId: string, projectId: string) {
    return `${workspaceId}:${projectId}`;
  }

  publish(workspaceId: string, event: BusEvent) {
    this.emitter.emit(this.channel(workspaceId, event.projectId), event);
  }

  subscribe(
    workspaceId: string,
    projectId: string,
    handler: (event: BusEvent) => void,
  ): () => void {
    const channel = this.channel(workspaceId, projectId);
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}

const globalForBus = globalThis as unknown as { __cutlistBus?: Bus };
export const bus: Bus = globalForBus.__cutlistBus ?? new Bus();
if (process.env.NODE_ENV !== "production") globalForBus.__cutlistBus = bus;

// ── Presence (ephemeral, in-memory) ─────────────────────────────────────────

type Presence = Map<string, Map<string, { name: string; at: number }>>;
const globalForPresence = globalThis as unknown as {
  __cutlistPresence?: Presence;
};
const presence: Presence = globalForPresence.__cutlistPresence ?? new Map();
if (process.env.NODE_ENV !== "production")
  globalForPresence.__cutlistPresence = presence;

const PRESENCE_TTL = 45_000;

export function touchPresence(
  workspaceId: string,
  projectId: string,
  userId: string,
  name: string,
) {
  const key = `${workspaceId}:${projectId}`;
  const room = presence.get(key) ?? new Map();
  room.set(userId, { name, at: Date.now() });
  presence.set(key, room);
}

export function dropPresence(
  workspaceId: string,
  projectId: string,
  userId: string,
) {
  presence.get(`${workspaceId}:${projectId}`)?.delete(userId);
}

export function listPresence(workspaceId: string, projectId: string) {
  const room = presence.get(`${workspaceId}:${projectId}`);
  if (!room) return [];
  const cutoff = Date.now() - PRESENCE_TTL;
  const live: { id: string; name: string }[] = [];
  for (const [userId, entry] of room) {
    if (entry.at < cutoff) room.delete(userId);
    else live.push({ id: userId, name: entry.name });
  }
  return live;
}
