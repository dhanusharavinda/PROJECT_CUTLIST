import { json, route } from "@/lib/api";
import { run, now } from "@/lib/db";
import { assert, badRequest, can, requireCtx } from "@/lib/tenancy";
import { complete, hasLlm, LlmUnavailable } from "@/lib/ai/llm";
import { timecode } from "@/lib/format";
import { getRecommendation } from "@/lib/graph/recommendations";
import { recordEvent } from "@/lib/graph/events";
import { buildEditGraph } from "@/lib/graph/build";

type Params = { params: Promise<{ recommendationId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * "Why are you telling me this?"
 *
 * The fast tier, given the recommendation, the measurements around that moment
 * and the creator's own rules. The answer is stored on the recommendation when
 * it had no rationale, and always in the event log with the run that made it.
 */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { recommendationId } = await params;
  assert(can.runAi(ctx.role), "Viewers cannot ask the AI to explain.");

  const rec = getRecommendation(ctx, recommendationId);
  if (!hasLlm(ctx.workspace.id)) {
    throw badRequest("No language-model key is connected. Add one in Settings, then ask again.");
  }

  const graph = buildEditGraph(ctx, rec.project_id);
  const clip = graph.media.find((m) => m.id === rec.video_id);
  const around = graph.shots
    .filter(
      (shot) =>
        shot.video_id === rec.video_id &&
        rec.start_ms !== null &&
        shot.end_ms >= rec.start_ms - 3000 &&
        shot.start_ms <= (rec.end_ms ?? rec.start_ms) + 3000,
    )
    .slice(0, 8)
    .map(
      (shot) =>
        `${timecode(shot.start_ms)} to ${timecode(shot.end_ms)}: motion ${shot.motion.toFixed(2)}, brightness ${shot.brightness.toFixed(2)}, saturation ${shot.saturation.toFixed(2)}${shot.stable ? ", locked off" : ""}`,
    )
    .join("\n");

  const rules = graph.guardrails.length ? graph.guardrails.map((g) => `- ${g}`).join("\n") : "(none written)";

  try {
    const result = await complete(ctx.workspace.id, {
      tier: "fast",
      task: "explain",
      projectId: rec.project_id,
      system:
        "You are explaining one edit recommendation to the creator who will decide on it. Three or four sentences. Say what was measured, why it matters for this kind of reel, and what happens if they ignore it. Plain words, no hype, no em dashes. If the recommendation conflicts with one of the creator's rules, say so first.",
      user: `Recommendation: [${rec.type}] ${rec.title}
Detail: ${rec.detail || rec.rationale || "(none)"}
Where: ${rec.start_ms !== null ? timecode(rec.start_ms) : "whole reel"}${rec.end_ms ? ` to ${timecode(rec.end_ms)}` : ""} on ${clip?.source_name ?? "the project"}
Confidence: ${rec.confidence}
Source: ${rec.source}

Measured around that moment:
${around || "(no shot data for this moment)"}

Creator's rules:
${rules}

Brief: ${JSON.stringify(graph.brief.readable).slice(0, 1200)}`,
      maxTokens: 400,
    });

    const explanation = result.text.trim();

    if (!rec.rationale.trim()) {
      run(
        "UPDATE recommendations SET rationale = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
        explanation.slice(0, 2000),
        now(),
        rec.id,
        ctx.workspace.id,
      );
    }

    recordEvent(ctx, rec.project_id, {
      kind: "recommendation.explained",
      actorKind: "ai",
      subjectType: "recommendation",
      subjectId: rec.id,
      payload: { run_id: result.runId, model: result.model },
    });

    return json({ explanation, runId: result.runId, model: result.model });
  } catch (err) {
    if (err instanceof LlmUnavailable) throw badRequest(err.message);
    throw err;
  }
});
