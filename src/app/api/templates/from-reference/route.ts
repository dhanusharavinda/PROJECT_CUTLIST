import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, badRequest, can, getVideo, requireCtx } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";
import { LlmUnavailable } from "@/lib/ai/llm";
import { createTemplate } from "@/lib/templates/store";
import { NothingToRead, styleFromReference } from "@/lib/templates/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FromReference = z.object({
  videoId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  /** Preview the profile without saving a template. */
  dryRun: z.boolean().optional(),
});

/**
 * A reel becomes a template: its measured rhythm and its read look, saved as
 * the style fields a project can start from.
 */
export const POST = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.editBrief(ctx.role), "Only owners and creators make templates.");

  const input = FromReference.parse(await body(req));
  const video = getVideo(ctx, input.videoId);

  try {
    const profile = await styleFromReference(ctx, video.id);
    if (input.dryRun) return json({ profile });

    const template = createTemplate(ctx, {
      name: input.name ?? `Style of ${video.title}`.slice(0, 120),
      category: typeof profile.payload.brief.category === "string" ? profile.payload.brief.category : "",
      description: profile.measured.slice(0, 2).join(". "),
      payload: profile.payload,
      summary: `Read from ${video.title}`,
    });

    logActivity({
      workspaceId: ctx.workspace.id,
      projectId: video.project_id,
      actorId: ctx.user.id,
      verb: "template.from_reference",
      summary: `Template ${template.name} read from ${video.title}`,
    });

    return json({ template, profile });
  } catch (err) {
    if (err instanceof NothingToRead || err instanceof LlmUnavailable) throw badRequest(err.message);
    throw err;
  }
});
