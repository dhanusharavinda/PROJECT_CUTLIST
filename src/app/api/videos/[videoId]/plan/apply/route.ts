import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, now, run, tx } from "@/lib/db";
import { assert, badRequest, can, getVideo, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { latestPlan } from "@/lib/analysis/store";

type Params = { params: Promise<{ videoId: string }> };

export const dynamic = "force-dynamic";

const Apply = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(40),
});

/**
 * Accept plan items into the cut list.
 *
 * A suggestion is not an instruction until the creator says so. Accepted items
 * become ordinary labels, which means the timeline, the export and the editor's
 * checklist all work on them with no special case.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.createLabel(ctx.role), "Viewers cannot add to the cut list.");

  const { itemIds } = Apply.parse(await body(req));
  const plan = latestPlan(ctx, video.id);
  if (!plan?.payload) throw badRequest("There is no edit plan for this clip yet.");

  const wanted = new Set(itemIds);
  const items = plan.payload.items.filter((item) => wanted.has(item.id));
  if (items.length === 0) throw badRequest("Those items are no longer in the plan.");

  tx(() => {
    for (const item of items) {
      run(
        `INSERT INTO labels
           (id, workspace_id, project_id, video_id, note_id, type, title, detail,
            start_ms, end_ms, priority, status, confidence, origin, source, assignee_id,
            created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id("lab"),
        ctx.workspace.id,
        video.project_id,
        video.id,
        null,
        item.type,
        item.title.slice(0, 200),
        item.detail.slice(0, 2000),
        item.start_ms,
        item.end_ms,
        item.priority,
        "open",
        item.confidence,
        item.source === "ai" ? "ai" : "heuristic",
        "analysis",
        null,
        now(),
        now(),
      );
    }
  });

  emit(
    ctx.workspace.id,
    { type: "label", projectId: video.project_id, payload: { videoId: video.id } },
    {
      actorId: ctx.user.id,
      verb: "plan.applied",
      summary: `${items.length} suggestion${items.length === 1 ? "" : "s"} added to the cut list for ${video.title}`,
    },
  );

  return json({ added: items.length });
});
