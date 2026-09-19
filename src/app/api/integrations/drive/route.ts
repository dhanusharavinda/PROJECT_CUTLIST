import { json, route } from "@/lib/api";
import { assert, badRequest, can, requireCtx } from "@/lib/tenancy";
import {
  disconnect,
  DriveError,
  driveConfigured,
  getConnection,
  listVideos,
} from "@/lib/drive";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Browse the connected account's video files. */
export const GET = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.uploadMedia(ctx.role), "Viewers cannot browse Drive.");

  const connection = getConnection(ctx.workspace.id);
  if (!connection) {
    return json({
      connected: false,
      available: driveConfigured(),
      files: [],
    });
  }

  const url = new URL(req.url);
  try {
    const result = await listVideos(ctx.workspace.id, {
      search: url.searchParams.get("q") || undefined,
      pageToken: url.searchParams.get("pageToken") || undefined,
      folderId: url.searchParams.get("folderId") || undefined,
    });

    return json({
      connected: true,
      available: true,
      accountEmail: connection.account_email,
      ...result,
    });
  } catch (err) {
    if (err instanceof DriveError) throw badRequest(err.message);
    throw err;
  }
});

export const DELETE = route(async () => {
  const ctx = await requireCtx();
  assert(can.manageSecrets(ctx.role), "Only owners and creators can disconnect Drive.");

  disconnect(ctx.workspace.id);
  logActivity({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    verb: "drive.disconnected",
    summary: "Google Drive disconnected",
  });

  return json({ ok: true });
});
