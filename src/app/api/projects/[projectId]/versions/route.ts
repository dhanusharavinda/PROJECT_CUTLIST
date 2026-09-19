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
import { versionSnapshot } from "@/lib/graph/snapshot";

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

  const actorKind =
    input.kind === "ai_draft" || input.kind === "ai_revision" ? "ai" : actorFor(ctx.role);

  const version = createProjectVersion(ctx, projectId, {
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    actorKind,
    actorId: actorKind === "ai" ? ctx.user.id : undefined,
    videoId: input.videoId ?? null,
    payload: versionSnapshot(ctx, projectId, actorKind, input),
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
