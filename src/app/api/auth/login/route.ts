import { z } from "zod";
import { cookies } from "next/headers";
import { body, json, route } from "@/lib/api";
import { one } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { createSession, sweepExpiredSessions } from "@/lib/auth";
import { HttpError, WS_COOKIE_NAME, workspacesFor } from "@/lib/tenancy";

const Input = z.object({
  email: z.string().trim().toLowerCase().email("That email doesn't look right."),
  password: z.string().min(1, "Enter your password."),
});

export const POST = route(async (req) => {
  const input = Input.parse(await body(req));

  const user = one<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = ?",
    input.email,
  );

  // Same message either way; don't reveal which emails exist.
  if (!user || !verifyPassword(input.password, user.password_hash)) {
    throw new HttpError(401, "Email or password is incorrect.");
  }

  sweepExpiredSessions();
  await createSession(user.id);

  const workspaces = workspacesFor(user.id);
  if (workspaces[0]) {
    const jar = await cookies();
    jar.set(WS_COOKIE_NAME, workspaces[0].id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return json({ ok: true });
});
