import { json, route } from "@/lib/api";
import { getProject, requireCtx } from "@/lib/tenancy";
import { listRecommendations } from "@/lib/graph/recommendations";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

/**
 * What the AI has proposed for this project. `?all=1` includes the superseded
 * and converted history; the default is what is still on the table.
 */
export const GET = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);

  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId");
  const all = url.searchParams.get("all") === "1";

  return json({
    recommendations: listRecommendations(ctx, projectId, {
      videoId: videoId === null ? undefined : videoId || null,
      live: !all,
    }),
  });
});
