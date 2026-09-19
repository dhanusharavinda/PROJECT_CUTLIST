import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, can, getProject, getVideo, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { actorFor } from "@/lib/graph/events";
import {
  createProjectVersion,
  listProjectVersions,
  VERSION_KINDS,
} from "@/lib/graph/versions";
import { reelView } from "@/lib/reel/store";
import { listLabels } from "@/lib/queries";
import { listRecommendations } from "@/lib/graph/recommendations";
import { diffSnapshots, ignoredLine } from "@/lib/graph/diff";
import { listVideos } from "@/lib/queries";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  return json({ versions: listProjectVersions(ctx, projectId) });
});

const Create = z.object({
  kind: z.enum(VERSION_KINDS),
  title: z.string().trim().max(120).optional(),
  summary: z.string().trim().max(2000).optional(),
  /** The returned cut, when there is a file for it. */
  videoId: z.string().trim().min(1).nullable().optional(),
  /** Instruction ids the person marks done or left open, when they tell us. */
  completed: z.array(z.string()).max(400).optional(),
  unresolved: z.array(z.string()).max(400).optional(),
  changes: z.array(z.string().trim().max(300)).max(60).optional(),
});

/**
 * A person or an agent marks a moment: "this is what came back". The snapshot
 * is what the reel and the counts looked like right then, so the next version
 * can be compared against it.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.createLabel(ctx.role), "Viewers cannot record a version.");

  const input = Create.parse(await body(req));
  if (input.videoId) {
    const cut = getVideo(ctx, input.videoId);
    if (cut.project_id !== projectId) {
      throw new Error("That clip belongs to a different project.");
    }
  }

  const reel = reelView(ctx, projectId);
  const labels = listLabels(ctx, projectId);
  const recs = listRecommendations(ctx, projectId, { live: true });

  const actorKind =
    input.kind === "ai_draft" || input.kind === "ai_revision" ? "ai" : actorFor(ctx.role);

  // What changed is measured against the previous version, never invented.
  // Anything the person wrote themselves comes first; the measured lines follow.
  const previous = listProjectVersions(ctx, projectId).at(-1) ?? null;
  const names = new Map(listVideos(ctx, projectId).map((v) => [v.id, v.source_name || v.title]));
  const who = actorKind === "ai" ? "AI" : actorKind === "creator" ? "Creator" : "Human";
  const snapshot = {
    slots: reel.slots.map((s) => ({ video_id: s.video_id, in_ms: s.in_ms, out_ms: s.out_ms })),
    total_ms: reel.total_ms,
  };
  const measured = diffSnapshots(previous?.payload ?? null, snapshot, names, who).map((d) => d.text);
  const ignored =
    who === "Human" || who === "AI"
      ? ignoredLine(recs.filter((r) => r.status === "approved").length, who)
      : null;
  const changes = [...(input.changes ?? []), ...measured, ...(ignored ? [ignored.text] : [])].filter(
    (line, index, all) => all.indexOf(line) === index,
  );

  const version = createProjectVersion(ctx, projectId, {
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    actorKind,
    actorId: actorKind === "ai" ? ctx.user.id : undefined,
    videoId: input.videoId ?? null,
    payload: {
      slots: reel.slots.map((s) => ({ video_id: s.video_id, in_ms: s.in_ms, out_ms: s.out_ms })),
      total_ms: reel.total_ms,
      open_instructions: labels.filter((l) => l.status === "open" || l.status === "doing").length,
      proposed_recommendations: recs.filter((r) => r.status === "proposed").length,
      completed: input.completed ?? [],
      unresolved: input.unresolved ?? [],
      changes,
    },
  });

  emit(
    ctx.workspace.id,
    { type: "graph", projectId, payload: { version: version.id } },
    {
      actorId: ctx.user.id,
      verb: "version.created",
      summary: `${version.label} recorded on ${project.name}`,
    },
  );

  return json({ version });
});
