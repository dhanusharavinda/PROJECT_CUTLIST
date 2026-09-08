import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { unsign } from "@/lib/crypto";
import { exchangeCode, saveConnection } from "@/lib/drive";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

function back(status: string, detail?: string) {
  const base = process.env.APP_URL || "http://localhost:3000";
  const url = new URL("/app/settings", base);
  url.searchParams.set("drive", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back("error", error);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("error", "Google did not return an authorisation code.");

  const value = unsign(state);
  if (!value) return back("error", "The authorisation state could not be verified.");

  const [workspaceId, userId] = value.split(":");
  if (!workspaceId || !userId) return back("error", "Malformed authorisation state.");

  // The signature proves the state came from us; re-check the membership is
  // still valid in case it was revoked while the user was on Google's screen.
  const membership = one<{ role: string }>(
    "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?",
    workspaceId,
    userId,
  );
  if (!membership || !["owner", "creator"].includes(membership.role)) {
    return back("error", "You no longer have permission to connect Drive here.");
  }

  try {
    const tokens = await exchangeCode(code);
    saveConnection(workspaceId, userId, tokens);
    logActivity({
      workspaceId,
      actorId: userId,
      verb: "drive.connected",
      summary: "Google Drive connected",
    });
    return back("connected");
  } catch (err) {
    return back("error", (err as Error).message);
  }
}
