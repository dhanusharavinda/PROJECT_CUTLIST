import { z } from "zod";
import { cookies } from "next/headers";
import { body, json, route } from "@/lib/api";
import { id, now, one, run, tx } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { createSession } from "@/lib/auth";
import { HttpError, WS_COOKIE_NAME } from "@/lib/tenancy";
import { slugify } from "@/lib/format";
import { logActivity } from "@/lib/activity";

const Input = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(80),
  email: z.string().trim().toLowerCase().email("That email doesn't look right."),
  password: z.string().min(8, "Use at least 8 characters."),
  workspaceName: z.string().trim().min(1, "Name your workspace.").max(80),
  inviteToken: z.string().trim().optional(),
});

export const POST = route(async (req) => {
  if ((process.env.SIGNUP_MODE || "open") === "closed") {
    const raw = await body<{ inviteToken?: string }>(req.clone());
    if (!raw.inviteToken)
      throw new HttpError(403, "This instance is invite-only.");
  }

  const input = Input.parse(await body(req));

  if (one("SELECT id FROM users WHERE email = ?", input.email)) {
    throw new HttpError(409, "An account with that email already exists.");
  }

  const userId = id("usr");
  const workspaceId = tx(() => {
    run(
      "INSERT INTO users (id, email, name, password_hash, accent, created_at) VALUES (?,?,?,?,?,?)",
      userId,
      input.email,
      input.name,
      hashPassword(input.password),
      "lime",
      now(),
    );

    // An invite decides which workspace they land in; otherwise they own a new one.
    if (input.inviteToken) {
      const invite = one<{
        id: string;
        workspace_id: string;
        role: "creator" | "editor" | "viewer";
        email: string;
        accepted_at: number | null;
      }>("SELECT * FROM invites WHERE token = ?", input.inviteToken);

      if (!invite || invite.accepted_at)
        throw new HttpError(400, "That invite link is no longer valid.");

      run(
        "INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
        id("mem"),
        invite.workspace_id,
        userId,
        invite.role,
        now(),
      );
      run("UPDATE invites SET accepted_at = ? WHERE id = ?", now(), invite.id);
      logActivity({
        workspaceId: invite.workspace_id,
        actorId: userId,
        verb: "member.joined",
        summary: `${input.name} joined as ${invite.role}`,
      });
      return invite.workspace_id;
    }

    const wsId = id("wsp");
    const base = slugify(input.workspaceName);
    let slug = base;
    for (let n = 2; one("SELECT id FROM workspaces WHERE slug = ?", slug); n++) {
      slug = `${base}-${n}`;
    }

    run(
      "INSERT INTO workspaces (id, name, slug, owner_id, created_at) VALUES (?,?,?,?,?)",
      wsId,
      input.workspaceName,
      slug,
      userId,
      now(),
    );
    run(
      "INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
      id("mem"),
      wsId,
      userId,
      "owner",
      now(),
    );

    // Give them somewhere to land rather than an empty dashboard.
    const projectId = id("prj");
    run(
      `INSERT INTO projects (id, workspace_id, name, summary, status, due_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      projectId,
      wsId,
      "First project",
      "Attach a clip, record one voice note over it, and see what comes back.",
      "briefing",
      null,
      userId,
      now(),
      now(),
    );
    run(
      "INSERT INTO briefs (project_id, workspace_id, payload, completeness, updated_by, updated_at) VALUES (?,?,?,?,?,?)",
      projectId,
      wsId,
      "{}",
      0,
      userId,
      now(),
    );
    logActivity({
      workspaceId: wsId,
      projectId,
      actorId: userId,
      verb: "workspace.created",
      summary: `${input.workspaceName} created`,
    });
    return wsId;
  });

  await createSession(userId);
  const jar = await cookies();
  jar.set(WS_COOKIE_NAME, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return json({ ok: true });
});
