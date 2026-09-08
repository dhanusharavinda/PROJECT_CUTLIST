import { z } from "zod";
import { cookies } from "next/headers";
import { body, json, route } from "@/lib/api";
import { forbidden, requireUser, workspacesFor, WS_COOKIE_NAME } from "@/lib/tenancy";

const Input = z.object({ workspaceId: z.string().min(1) });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { workspaceId } = Input.parse(await body(req));

  // Membership is the only thing that makes a workspace selectable.
  if (!workspacesFor(user.id).some((w) => w.id === workspaceId)) {
    throw forbidden("You are not a member of that workspace.");
  }

  (await cookies()).set(WS_COOKIE_NAME, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return json({ ok: true });
});
