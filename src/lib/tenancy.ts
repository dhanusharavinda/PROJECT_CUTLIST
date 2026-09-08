import { cookies } from "next/headers";
import { many, one } from "./db";
import { currentUser } from "./auth";
import type { Label, Note, Project, Role, User, Video, Workspace } from "./types";

const WS_COOKIE = "cutlist_ws";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "Sign in to continue.");
export const forbidden = (what = "You do not have access to this.") =>
  new HttpError(403, what);
export const notFound = (what = "Not found.") => new HttpError(404, what);
export const badRequest = (what: string) => new HttpError(400, what);

/**
 * Every request that touches tenant data resolves through here.
 * `ctx.workspace.id` is the ONLY workspace id that may appear in a query.
 */
export interface Ctx {
  user: User;
  workspace: Workspace;
  role: Role;
  workspaces: (Workspace & { role: Role })[];
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw unauthorized();
  return user;
}

export function workspacesFor(userId: string): (Workspace & { role: Role })[] {
  return many<Workspace & { role: Role }>(
    `SELECT w.*, m.role AS role
       FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ?
      ORDER BY w.created_at ASC`,
    userId,
  );
}

/**
 * Resolve the caller's active workspace. A workspace id may be *requested*
 * (cookie or explicit argument) but is only honoured if a membership backs it —
 * otherwise we silently fall back to the first workspace the user belongs to.
 */
export async function requireCtx(requested?: string | null): Promise<Ctx> {
  const user = await requireUser();
  const workspaces = workspacesFor(user.id);
  if (workspaces.length === 0)
    throw new HttpError(403, "You are not a member of any workspace yet.");

  const jar = await cookies();
  const wanted = requested ?? jar.get(WS_COOKIE)?.value ?? null;
  const active =
    (wanted && workspaces.find((w) => w.id === wanted)) || workspaces[0];

  return { user, workspace: active, role: active.role, workspaces };
}

export const WS_COOKIE_NAME = WS_COOKIE;

// ── Capability checks ───────────────────────────────────────────────────────

const RANK: Record<Role, number> = { viewer: 0, editor: 1, creator: 2, owner: 3 };

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/** Owners and creators shape the brief; editors execute it. */
export const can = {
  manageWorkspace: (r: Role) => r === "owner",
  manageMembers: (r: Role) => atLeast(r, "creator"),
  manageSecrets: (r: Role) => atLeast(r, "creator"),
  createProject: (r: Role) => atLeast(r, "creator"),
  editBrief: (r: Role) => atLeast(r, "creator"),
  uploadMedia: (r: Role) => atLeast(r, "editor"),
  createNote: (r: Role) => atLeast(r, "editor"),
  updateLabelStatus: (r: Role) => atLeast(r, "editor"),
  createLabel: (r: Role) => atLeast(r, "editor"),
  chat: (r: Role) => atLeast(r, "editor"),
  runAi: (r: Role) => atLeast(r, "editor"),
};

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw forbidden(message);
}

// ── Scoped fetches. Each one pins workspace_id explicitly. ──────────────────

export function getProject(ctx: Ctx, projectId: string): Project {
  const project = one<Project>(
    "SELECT * FROM projects WHERE id = ? AND workspace_id = ?",
    projectId,
    ctx.workspace.id,
  );
  if (!project) throw notFound("Project not found in this workspace.");
  return project;
}

export function getVideo(ctx: Ctx, videoId: string): Video {
  const video = one<Video>(
    "SELECT * FROM videos WHERE id = ? AND workspace_id = ?",
    videoId,
    ctx.workspace.id,
  );
  if (!video) throw notFound("Video not found in this workspace.");
  return video;
}

export function getNote(ctx: Ctx, noteId: string): Note {
  const note = one<Note>(
    "SELECT * FROM notes WHERE id = ? AND workspace_id = ?",
    noteId,
    ctx.workspace.id,
  );
  if (!note) throw notFound("Note not found in this workspace.");
  return note;
}

export function getLabel(ctx: Ctx, labelId: string): Label {
  const label = one<Label>(
    "SELECT * FROM labels WHERE id = ? AND workspace_id = ?",
    labelId,
    ctx.workspace.id,
  );
  if (!label) throw notFound("Label not found in this workspace.");
  return label;
}
