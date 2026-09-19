import { json, route } from "@/lib/api";
import { assert, can, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { seedFromFootage } from "@/lib/reel/store";

type Params = { params: Promise<{ projectId: string }> };

/**
 * Fill the reel with every clip, whole, so there is something to reorder.
 *
 * Destructive on purpose: it replaces whatever is there. The UI asks first, and
 * anything the creator had trimmed is faster to redo than a blank timeline is to
 * fill from nothing.
 */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot change the reel.");

  const { reel, skipped } = seedFromFootage(ctx, projectId);

  emit(
    ctx.workspace.id,
    { type: "reel", projectId, payload: { shots: reel.shots } },
    {
      actorId: ctx.user.id,
      verb: "reel.saved",
      summary: `${ctx.user.name} filled the reel from the footage: ${
        reel.shots
      } ${reel.shots === 1 ? "clip" : "clips"}`,
    },
  );

  // Clips with no known length cannot become slots, so the screen is told how
  // many were left out rather than the creator wondering where they went.
  return json({ reel, skipped });
});
