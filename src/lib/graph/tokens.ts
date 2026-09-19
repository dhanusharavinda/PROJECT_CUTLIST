import { createHash, randomBytes } from "node:crypto";
import { id, many, now, one, run } from "../db";
import type { Ctx } from "../tenancy";
import type { Role, User, Workspace } from "../types";

/**
 * Read-only access for an outside agent, scoped to one project.
 *
 * A token is shown once and only its hash is stored. Presenting it yields a
 * context that can read that one project and nothing else: the workspace is
 * pinned from the token row, the role is viewer, and the MCP tools it unlocks
 * are all reads. Revoking is a timestamp, so the record of what was issued
 * survives.
 */

export interface AccessTokenRow {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  token_hash: string;
  scopes: string;
  created_by: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface AccessTokenView {
  id: string;
  name: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  revoked: boolean;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function view(row: AccessTokenRow): AccessTokenView {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked: row.revoked_at !== null,
  };
}

export function listTokens(ctx: Ctx, projectId: string): AccessTokenView[] {
  return many<AccessTokenRow>(
    "SELECT * FROM access_tokens WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC",
    ctx.workspace.id,
    projectId,
  ).map(view);
}

/** Returns the plaintext once. It is never retrievable again. */
export function createToken(
  ctx: Ctx,
  projectId: string,
  name: string,
): { token: string; row: AccessTokenView } {
  const token = `clt_${randomBytes(24).toString("base64url")}`;
  const tokenId = id("tok");
  run(
    `INSERT INTO access_tokens (id, workspace_id, project_id, name, token_hash, scopes, created_by, created_at)
     VALUES (?,?,?,?,?,'read',?,?)`,
    tokenId,
    ctx.workspace.id,
    projectId,
    name.trim().slice(0, 80) || "External agent",
    hash(token),
    ctx.user.id,
    now(),
  );
  const row = one<AccessTokenRow>("SELECT * FROM access_tokens WHERE id = ?", tokenId)!;
  return { token, row: view(row) };
}

export function revokeToken(ctx: Ctx, projectId: string, tokenId: string): boolean {
  const result = run(
    "UPDATE access_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND project_id = ? AND revoked_at IS NULL",
    now(),
    tokenId,
    ctx.workspace.id,
    projectId,
  );
  return Number(result.changes) > 0;
}

export interface TokenPrincipal {
  ctx: Ctx;
  projectId: string;
  tokenId: string;
}

/**
 * Turn a bearer token into a read-only context. The user on it is the person
 * who issued the token, the role is viewer, and the workspace list is empty so
 * nothing can switch workspaces.
 */
export function authenticateToken(bearer: string | null): TokenPrincipal | null {
  if (!bearer || !bearer.startsWith("clt_")) return null;
  const row = one<AccessTokenRow>(
    "SELECT * FROM access_tokens WHERE token_hash = ? AND revoked_at IS NULL",
    hash(bearer),
  );
  if (!row) return null;

  const workspace = one<Workspace>("SELECT * FROM workspaces WHERE id = ?", row.workspace_id);
  if (!workspace) return null;
  const issuer = row.created_by ? one<User>("SELECT * FROM users WHERE id = ?", row.created_by) : null;

  // A token outlives its issuer's membership only on paper: once they are out
  // of the workspace, everything they issued stops working too.
  if (row.created_by) {
    const member = one<{ id: string }>(
      "SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ?",
      row.workspace_id,
      row.created_by,
    );
    if (!member) return null;
  }

  run("UPDATE access_tokens SET last_used_at = ? WHERE id = ?", now(), row.id);

  const role: Role = "viewer";
  return {
    tokenId: row.id,
    projectId: row.project_id,
    ctx: {
      user: issuer ?? {
        id: `token:${row.id}`,
        email: "",
        name: row.name,
        accent: "lime",
        created_at: row.created_at,
      },
      workspace,
      role,
      workspaces: [],
    },
  };
}
