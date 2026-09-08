import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, many, now, one, run } from "@/lib/db";
import { assert, badRequest, can, requireCtx } from "@/lib/tenancy";
import { randomToken } from "@/lib/crypto";
import { logActivity } from "@/lib/activity";
import type { Member } from "@/lib/types";

export const GET = route(async () => {
  const ctx = await requireCtx();

  const members = many<Member>(
    `SELECT u.id, u.email, u.name, u.accent, u.created_at, m.role, m.id AS membership_id
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'creator' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
               u.name`,
    ctx.workspace.id,
  );

  const invites = many<{
    id: string;
    email: string;
    role: string;
    token: string;
    created_at: number;
  }>(
    "SELECT id, email, role, token, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC",
    ctx.workspace.id,
  );

  return json({ members, invites, role: ctx.role });
});

const Invite = z.object({
  email: z.string().trim().toLowerCase().email("That email doesn't look right."),
  role: z.enum(["creator", "editor", "viewer"]),
});

export const POST = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.manageMembers(ctx.role), "Only owners and creators can invite people.");

  const input = Invite.parse(await body(req));

  const already = one<{ id: string }>(
    `SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ? AND u.email = ?`,
    ctx.workspace.id,
    input.email,
  );
  if (already) throw badRequest("That person is already in this workspace.");

  // Re-inviting the same address replaces the old link rather than stacking up.
  run(
    "DELETE FROM invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL",
    ctx.workspace.id,
    input.email,
  );

  const token = randomToken(18);
  run(
    "INSERT INTO invites (id, workspace_id, email, role, token, invited_by, created_at) VALUES (?,?,?,?,?,?,?)",
    id("inv"),
    ctx.workspace.id,
    input.email,
    input.role,
    token,
    ctx.user.id,
    now(),
  );

  logActivity({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    verb: "member.invited",
    summary: `${input.email} invited as ${input.role}`,
  });

  const base = process.env.APP_URL || "http://localhost:3000";
  return json({ token, url: `${base}/join/${token}` });
});

const Patch = z.object({
  membershipId: z.string().min(1),
  role: z.enum(["creator", "editor", "viewer"]),
});

export const PATCH = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.manageMembers(ctx.role), "Only owners and creators can change roles.");

  const input = Patch.parse(await body(req));
  const target = one<{ user_id: string; role: string }>(
    "SELECT user_id, role FROM memberships WHERE id = ? AND workspace_id = ?",
    input.membershipId,
    ctx.workspace.id,
  );
  if (!target) throw badRequest("That membership is not in this workspace.");
  if (target.role === "owner")
    throw badRequest("The workspace owner's role cannot be changed.");

  run(
    "UPDATE memberships SET role = ? WHERE id = ? AND workspace_id = ?",
    input.role,
    input.membershipId,
    ctx.workspace.id,
  );
  return json({ ok: true });
});

export const DELETE = route(async (req) => {
  const ctx = await requireCtx();
  const url = new URL(req.url);
  const membershipId = url.searchParams.get("membershipId");
  const inviteId = url.searchParams.get("inviteId");

  assert(can.manageMembers(ctx.role), "Only owners and creators can remove people.");

  if (inviteId) {
    run(
      "DELETE FROM invites WHERE id = ? AND workspace_id = ?",
      inviteId,
      ctx.workspace.id,
    );
    return json({ ok: true });
  }

  if (!membershipId) throw badRequest("Nothing to remove.");

  const target = one<{ role: string; user_id: string }>(
    "SELECT role, user_id FROM memberships WHERE id = ? AND workspace_id = ?",
    membershipId,
    ctx.workspace.id,
  );
  if (!target) throw badRequest("That membership is not in this workspace.");
  if (target.role === "owner")
    throw badRequest("The workspace owner cannot be removed.");

  run(
    "DELETE FROM memberships WHERE id = ? AND workspace_id = ?",
    membershipId,
    ctx.workspace.id,
  );
  logActivity({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    verb: "member.removed",
    summary: "A member was removed from the workspace",
  });
  return json({ ok: true });
});
