import { json, route } from "@/lib/api";
import { getProject, requireCtx } from "@/lib/tenancy";
import { buildEditGraph, compactGraph } from "@/lib/graph/build";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

/**
 * The EditGraph: everything the project knows, in one read. `?compact=1`
 * trims the event log and the shot table to what a model or an outside agent
 * needs to reason.
 */
export const GET = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);

  const graph = buildEditGraph(ctx, projectId);
  const compact = new URL(req.url).searchParams.get("compact") === "1";
  return json({ graph: compact ? compactGraph(graph) : graph });
});
