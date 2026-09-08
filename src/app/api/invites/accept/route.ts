import { z } from "zod";
import { cookies } from "next/headers";
import { body, json, route } from "@/lib/api";
import { id, now, one, run } from "@/lib/db";
import { requireUser, HttpError, WS_COOKIE_NAME } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";

const Input = z.object({ token: z.string().min(1) });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { token } = Input.parse(await body(req));

  const invite = one<{
    id: string;
    workspace_id: string;
    role: "creator" | "editor" | "viewer";
    accepted_at: number | null;
  }>("SELECT id, workspace_id, role, accepted_at FROM invites WHERE token = ?", token);

  if (!invite || invite.accepted_at)
    throw new HttpError(400, "That invite link is no longer valid.");

  const existing = one(
    "SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ?",
    invite.workspace_id,
    user.id,
  );

  if (!existing) {
    run(
      "INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
      id("mem"),
      invite.workspace_id,
      user.id,
      invite.role,
      now(),
    );
    logActivity({
      workspaceId: invite.workspace_id,
      actorId: user.id,
      verb: "member.joined",
      summary: `${user.name} joined as ${invite.role}`,
    });
  }

  run("UPDATE invites SET accepted_at = ? WHERE id = ?", now(), invite.id);

  (await cookies()).set(WS_COOKIE_NAME, invite.workspace_id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return json({ workspaceId: invite.workspace_id });
});
