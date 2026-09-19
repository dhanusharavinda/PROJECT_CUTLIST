import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, badRequest, can, getProject, getVideo, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { briefForPrompt } from "@/lib/brief";
import { loadBrief, listNotes } from "@/lib/queries";
import { hasLlm, LlmUnavailable } from "@/lib/ai/llm";
import { readBuffer } from "@/lib/storage";
import { buildLocalPlan } from "@/lib/analysis/planner";
import { aiPlan } from "@/lib/analysis/vision";
import {
  getAnalysis,
  latestPlan,
  listFrames,
  referenceTemplate,
  savePlan,
  setTags,
} from "@/lib/analysis/store";
import { NICHE_IDS } from "@/lib/analysis/presets";
import type { NicheId } from "@/lib/analysis/types";

type Params = { params: Promise<{ videoId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  return json({ plan: latestPlan(ctx, video.id) });
});

const Generate = z.object({
  niche: z.enum(["gym", "aesthetic", "surreal", "vlog", "general"]).optional(),
  useAi: z.boolean().optional(),
});

/**
 * Build the edit plan for one clip.
 *
 * The offline planner always runs. When a language-model key exists and the
 * caller did not opt out, the model gets the measurements plus a handful of
 * stills and its plan replaces the offline one, keeping any offline finding it
 * did not cover.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { videoId } = await params;
  const video = getVideo(ctx, videoId);
  assert(can.runAi(ctx.role), "Viewers cannot generate an edit plan.");

  const input = Generate.parse(await body(req).catch(() => ({})));
  const project = getProject(ctx, video.project_id);

  const analysis = getAnalysis(ctx, video.id);
  if (!analysis || analysis.status !== "done" || !analysis.payload) {
    throw badRequest(
      analysis?.status === "running"
        ? "The analysis is still running. Give it a moment."
        : "Analyse this clip first: the plan is built from its shots, beats and silences.",
    );
  }

  const nicheId = (input.niche ??
    (NICHE_IDS as string[]).find((n) => n === project.niche) ??
    "general") as NicheId;

  const brief = loadBrief(ctx, project.id);
  const notes = listNotes(ctx, project.id)
    .filter((note) => note.video_id === video.id && note.text.trim())
    .map((note) => ({ anchor_ms: note.anchor_ms, text: note.text }));

  const template =
    project.reference_video_id && project.reference_video_id !== video.id
      ? referenceTemplate(ctx, project.reference_video_id)
      : null;

  const briefForAi = Object.keys(brief.payload).length
    ? briefForPrompt(brief.payload)
    : null;

  const local = buildLocalPlan({
    videoTitle: video.title,
    niche: nicheId,
    analysis: analysis.payload,
    brief: briefForAi,
    template,
    notes,
  });

  let saved = null;
  let warning: string | null = null;

  const wantsAi = input.useAi !== false && hasLlm(ctx.workspace.id);
  if (wantsAi) {
    try {
      const frames = await Promise.all(
        listFrames(ctx, video.id)
          .slice(0, 12)
          .map(async (frame) => ({
            at_ms: frame.at_ms,
            mime: "image/jpeg",
            data: (await readBuffer(frame.storage_key)).toString("base64"),
          })),
      );

      const result = await aiPlan(ctx.workspace.id, {
        videoTitle: video.title,
        nicheId,
        analysis: analysis.payload,
        local,
        brief: briefForAi,
        template,
        notes,
        frames,
      });

      if (result) {
        saved = savePlan(ctx, {
          projectId: project.id,
          videoId: video.id,
          niche: nicheId,
          origin: "ai",
          model: result.payload.model,
          payload: result.payload,
        });
        if (result.tags.length) setTags(ctx, video.id, "ai", result.tags.map((tag) => ({ tag })));
      } else {
        warning = "The model returned nothing usable, so this is the offline plan.";
      }
    } catch (err) {
      warning =
        err instanceof LlmUnavailable
          ? `${err.message} This is the offline plan instead.`
          : "The AI pass failed, so this is the offline plan.";
    }
  }

  if (!saved) {
    saved = savePlan(ctx, {
      projectId: project.id,
      videoId: video.id,
      niche: nicheId,
      origin: "local",
      model: local.model,
      payload: local,
    });
  }

  emit(
    ctx.workspace.id,
    { type: "suggestion", projectId: project.id, payload: { videoId: video.id } },
    {
      actorId: ctx.user.id,
      verb: "plan.generated",
      summary: `Edit plan for ${video.title} (${saved.origin === "ai" ? "AI" : "offline"})`,
    },
  );

  return json({ plan: saved, warning, aiAvailable: hasLlm(ctx.workspace.id) });
});
