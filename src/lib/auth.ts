import { cookies } from "next/headers";
import { id, now, one, run } from "./db";
import { randomToken, sign, unsign } from "./crypto";
import type { User } from "./types";

const COOKIE = "cutlist_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function createSession(userId: string) {
  const sessionId = id("ses");
  const token = randomToken(24);
  run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)",
    `${sessionId}.${token}`,
    userId,
    now(),
    now() + TTL_MS,
  );
  const jar = await cookies();
  jar.set(COOKIE, sign(`${sessionId}.${token}`), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function destroySession() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const value = unsign(raw);
    if (value) run("DELETE FROM sessions WHERE id = ?", value);
  }
  jar.delete(COOKIE);
}

/** Current user, or null. Never throws. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const value = unsign(raw);
  if (!value) return null;

  const session = one<{ user_id: string; expires_at: number }>(
    "SELECT user_id, expires_at FROM sessions WHERE id = ?",
    value,
  );
  if (!session) return null;
  if (session.expires_at < now()) {
    run("DELETE FROM sessions WHERE id = ?", value);
    return null;
  }

  return one<User>(
    "SELECT id, email, name, accent, created_at FROM users WHERE id = ?",
    session.user_id,
  );
}

export function sweepExpiredSessions() {
  run("DELETE FROM sessions WHERE expires_at < ?", now());
}
