import { z } from "zod";
import { cookies } from "next/headers";
import { body, json, route } from "@/lib/api";
import { id, now, one, run, tx } from "@/lib/db";
import { requireUser, workspacesFor, WS_COOKIE_NAME } from "@/lib/tenancy";
import { slugify } from "@/lib/format";
import { logActivity } from "@/lib/activity";

export const GET = route(async () => {
  const user = await requireUser();
  return json({ workspaces: workspacesFor(user.id) });
});

const Create = z.object({
  name: z.string().trim().min(1, "Name the workspace.").max(80),
});

/** A second workspace is how one creator keeps two clients apart. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const input = Create.parse(await body(req));

  const workspaceId = tx(() => {
    const wsId = id("wsp");
    const base = slugify(input.name);
    let slug = base;
    for (let n = 2; one("SELECT id FROM workspaces WHERE slug = ?", slug); n++) {
      slug = `${base}-${n}`;
    }
    run(
      "INSERT INTO workspaces (id, name, slug, owner_id, created_at) VALUES (?,?,?,?,?)",
      wsId,
      input.name,
      slug,
      user.id,
      now(),
    );
    run(
      "INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
      id("mem"),
      wsId,
      user.id,
      "owner",
      now(),
    );
    logActivity({
      workspaceId: wsId,
      actorId: user.id,
      verb: "workspace.created",
      summary: `${input.name} created`,
    });
    return wsId;
  });

  const jar = await cookies();
  jar.set(WS_COOKIE_NAME, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return json({ id: workspaceId });
});
