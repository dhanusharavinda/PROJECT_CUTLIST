import { json, route } from "@/lib/api";
import { getProject, requireCtx } from "@/lib/tenancy";
import { listEvents } from "@/lib/graph/events";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

/** The project's history, oldest first. `?since=<ms>` for what happened after a moment. */
export const GET = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);

  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") || 0);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 300)));

  return json({
    events: listEvents(ctx, projectId, { since: Number.isFinite(since) ? since : 0, limit }),
  });
});
