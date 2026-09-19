import { z } from "zod";
import { body, json, route } from "@/lib/api";
import {
  assert,
  badRequest,
  can,
  getProject,
  getVideo,
  requireCtx,
} from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { reelView, replaceSlots } from "@/lib/reel/store";

type Params = { params: Promise<{ projectId: string }> };

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  return json({ reel: reelView(ctx, projectId) });
});

const Slot = z.object({
  videoId: z.string().min(1),
  inMs: z.number().int().nonnegative(),
  outMs: z.number().int().nonnegative(),
  note: z.string().trim().max(400).optional(),
  snap: z.enum(["manual", "shot", "beat"]).default("manual"),
});

const Save = z.object({
  items: z
    .array(Slot)
    .max(60, "A reel is 60 clips at most. Cut some before saving."),
});

/**
 * The reel is saved whole, never slot by slot.
 *
 * Order, in points and out points all move together while the creator works, so
 * one PUT of the finished order is both simpler and safer than a patch per slot:
 * there is no half-applied reorder to recover from.
 */
export const PUT = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot change the reel.");

  const input = Save.parse(await body(req));

  input.items.forEach((item, i) => {
    const at = `Slot ${i + 1}`;
    const video = getVideo(ctx, item.videoId);

    if (video.project_id !== projectId)
      throw badRequest(`${at}: that clip belongs to a different project.`);

    if (video.role === "reference")
      throw badRequest(
        `${at}: ${video.title} is a reference reel, not footage to cut. Change its role first.`,
      );

    // A clip nobody has measured yet reports duration_ms 0, which is allowed:
    // the browser fills the real length in on first play. The span still has to
    // be a real one, because reel time is a running sum and a zero-length slot
    // would shift every later slot in the handoff.
    if (video.duration_ms === 0 && item.outMs <= 0)
      throw badRequest(
        `${at}: ${video.title} has no measured length yet, so set an out point above zero yourself.`,
      );

    if (item.outMs <= item.inMs)
      throw badRequest(`${at}: the out point has to come after the in point.`);
  });

  const reel = replaceSlots(ctx, projectId, input.items);

  emit(
    ctx.workspace.id,
    { type: "reel", projectId, payload: { shots: reel.shots } },
    {
      actorId: ctx.user.id,
      verb: "reel.saved",
      summary: `${ctx.user.name} saved the reel: ${reel.shots} ${
        reel.shots === 1 ? "clip" : "clips"
      }`,
    },
  );

  return json({ reel });
});
