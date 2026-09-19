import { noEmDashDeep } from "@/lib/format";
import { json, route } from "@/lib/api";
import { id, now, run } from "@/lib/db";
import { assert, can, getProject, requireCtx } from "@/lib/tenancy";
import { loadAiContext } from "@/lib/queries";
import { briefForPrompt } from "@/lib/brief";
import { suggestForProject } from "@/lib/ai/suggest";
import { emit } from "@/lib/activity";

type Params = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The second-pair-of-eyes pass. Reads the brief, every transcript and the whole
 * cut list at once: the one place where the AI sees the project as a whole
 * rather than a single note.
 */
export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.runAi(ctx.role), "Viewers cannot run the review pass.");

  const context = loadAiContext(ctx, projectId);

  const { payload: raw, model } = await suggestForProject(ctx.workspace.id, {
    projectName: project.name,
    brief: Object.keys(context.brief.payload).length
      ? briefForPrompt(context.brief.payload)
      : null,
    videos: context.videos.map((v) => ({
      title: v.title,
      duration_ms: v.duration_ms,
    })),
    transcripts: context.transcripts,
    labels: context.labels.map((l) => ({
      type: l.type,
      title: l.title,
      start_ms: l.start_ms,
      priority: l.priority,
      status: l.status,
    })),
  });

  const payload = noEmDashDeep(raw);

  const suggestionId = id("sug");
  run(
    "INSERT INTO suggestions (id, workspace_id, project_id, video_id, payload, model, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    suggestionId,
    ctx.workspace.id,
    projectId,
    null,
    JSON.stringify(payload),
    model,
    ctx.user.id,
    now(),
  );

  // Drop the headline into the room so the editor sees it without hunting.
  run(
    "INSERT INTO messages (id, workspace_id, project_id, author_id, kind, body, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id("msg"),
    ctx.workspace.id,
    projectId,
    null,
    "ai",
    payload.headline,
    JSON.stringify({ suggestionId, items: payload.items.length, model }),
    now(),
  );

  const suggestion = {
    id: suggestionId,
    payload: JSON.stringify(payload),
    model,
    created_at: now(),
  };

  emit(
    ctx.workspace.id,
    { type: "suggestion", projectId, payload: suggestion },
    {
      actorId: ctx.user.id,
      verb: "ai.review",
      summary: `Review pass run on ${project.name} (${model})`,
    },
  );
  emit(ctx.workspace.id, { type: "message", projectId, payload: { refresh: true } });

  return json({ suggestion: { ...suggestion, parsed: payload }, model });
});
