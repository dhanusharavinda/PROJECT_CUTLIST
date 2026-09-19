import { json, route } from "@/lib/api";
import { assert, badRequest, can, requireCtx } from "@/lib/tenancy";
import {
  DriveError,
  driveConfigured,
  getConnection,
  listFolders,
} from "@/lib/drive";

export const dynamic = "force-dynamic";

/**
 * Folders, so the picker can be folder-first.
 *
 * One shoot is one folder is one reel, which is what keeps the clip the editor
 * opens and the clip named in the handoff the same file.
 */
export const GET = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.uploadMedia(ctx.role), "Viewers cannot browse Drive.");

  if (!getConnection(ctx.workspace.id)) {
    return json({ connected: false, available: driveConfigured(), folders: [] });
  }

  const url = new URL(req.url);
  try {
    const result = await listFolders(ctx.workspace.id, {
      parentId: url.searchParams.get("parentId") || undefined,
      search: url.searchParams.get("q") || undefined,
      pageToken: url.searchParams.get("pageToken") || undefined,
    });
    return json({ connected: true, available: true, ...result });
  } catch (err) {
    // Google said no: an expired grant, a revoked token, a rate limit. The
    // picker can show that sentence; a 500 would only say "our side".
    if (err instanceof DriveError) throw badRequest(err.message);
    throw err;
  }
});
