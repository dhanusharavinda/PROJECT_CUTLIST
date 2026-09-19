import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { many, now, run } from "@/lib/db";
import { assert, can, getProject, getVideo, requireCtx } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";
import { loadProjectDetail } from "@/lib/queries";
import { OWNER_STATES } from "@/lib/types";
import { recordEvent } from "@/lib/graph/events";
import { emit } from "@/lib/activity";
import { removeByPrefix, removeKey, removeTree } from "@/lib/storage";

type Params = { params: Promise<{ projectId: string }> };

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  return json(loadProjectDetail(ctx, getProject(ctx, projectId)));
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(600).optional(),
  status: z
    .enum(["briefing", "editing", "review", "delivered", "archived"])
    .optional(),
  dueAt: z.number().int().nullable().optional(),
  niche: z.enum(["gym", "aesthetic", "surreal", "vlog", "general"]).optional(),
  referenceVideoId: z.string().min(1).nullable().optional(),
  ownerState: z.enum(OWNER_STATES).optional(),
  musicNote: z.string().trim().max(400).optional(),
  footageUrl: z.string().trim().url().nullable().optional(),
});

export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);

  const input = Patch.parse(await body(req));

  // A reference reel has to be a clip in this workspace.
  if (input.referenceVideoId) getVideo(ctx, input.referenceVideoId);

  // Editors may move a project along the pipeline; only creators rename it.
  if (input.name !== undefined || input.summary !== undefined || input.dueAt !== undefined) {
    assert(can.editBrief(ctx.role), "Only owners and creators can edit project details.");
  } else {
    assert(can.updateLabelStatus(ctx.role), "Viewers cannot change a project.");
  }

  run(
    `UPDATE projects
        SET name = COALESCE(?, name),
            summary = COALESCE(?, summary),
            status = COALESCE(?, status),
            niche = COALESCE(?, niche),
            reference_video_id = CASE WHEN ? THEN ? ELSE reference_video_id END,
            owner_state = COALESCE(?, owner_state),
            music_note = COALESCE(?, music_note),
            footage_url = CASE WHEN ? THEN ? ELSE footage_url END,
            due_at = CASE WHEN ? THEN ? ELSE due_at END,
            updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
    input.name ?? null,
    input.summary ?? null,
    input.status ?? null,
    input.niche ?? null,
    input.referenceVideoId !== undefined ? 1 : 0,
    input.referenceVideoId ?? null,
    input.ownerState ?? null,
    input.musicNote ?? null,
    input.footageUrl !== undefined ? 1 : 0,
    input.footageUrl ?? null,
    input.dueAt !== undefined ? 1 : 0,
    input.dueAt ?? null,
    now(),
    projectId,
    ctx.workspace.id,
  );

  // Handing the edit to someone is a moment worth remembering by itself.
  if (input.ownerState && input.ownerState !== project.owner_state) {
    recordEvent(ctx, projectId, {
      kind: "owner.changed",
      payload: { from: project.owner_state, to: input.ownerState },
    });
    emit(
      ctx.workspace.id,
      { type: "graph", projectId, payload: { owner_state: input.ownerState } },
      {
        actorId: ctx.user.id,
        verb: "owner.changed",
        summary: `${project.name}: ${input.ownerState.replace(/_/g, " ")}`,
      },
    );
  }

  if (input.status && input.status !== project.status) {
    logActivity({
      workspaceId: ctx.workspace.id,
      projectId,
      actorId: ctx.user.id,
      verb: "project.status",
      summary: `${project.name} moved to ${input.status}`,
    });
  }

  return json(loadProjectDetail(ctx, getProject(ctx, projectId)));
});

export const DELETE = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.createProject(ctx.role), "Only owners and creators can delete a project.");

  // Rows cascade, files do not. Everything this project owns on disk has to be
  // gathered before the delete, because afterwards there is nothing to ask.
  const media = many<{ storage_key: string | null; proxy_key: string | null; id: string }>(
    "SELECT id, storage_key, proxy_key FROM videos WHERE workspace_id = ? AND project_id = ?",
    ctx.workspace.id,
    projectId,
  );
  const frames = many<{ storage_key: string }>(
    `SELECT f.storage_key FROM analysis_frames f
       JOIN videos v ON v.id = f.video_id AND v.workspace_id = f.workspace_id
      WHERE f.workspace_id = ? AND v.project_id = ?`,
    ctx.workspace.id,
    projectId,
  );
  const recordings = many<{ audio_key: string }>(
    `SELECT audio_key FROM notes
      WHERE workspace_id = ? AND project_id = ? AND audio_key IS NOT NULL`,
    ctx.workspace.id,
    projectId,
  );

  run(
    "DELETE FROM projects WHERE id = ? AND workspace_id = ?",
    projectId,
    ctx.workspace.id,
  );

  const keys = [
    ...media.flatMap((row) => [row.storage_key, row.proxy_key]),
    ...frames.map((row) => row.storage_key),
    ...recordings.map((row) => row.audio_key),
  ].filter((key): key is string => Boolean(key));

  await Promise.all(keys.map((key) => removeKey(key).catch(() => {})));
  await Promise.all(
    media.map((row) =>
      removeTree(`${ctx.workspace.id}/analysis/${row.id}`).catch(() => {}),
    ),
  );
  await removeByPrefix(
    `${ctx.workspace.id}/packet`,
    media.map((row) => row.id),
  ).catch(() => {});

  logActivity({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    verb: "project.deleted",
    summary: `${project.name} deleted`,
  });

  return json({ ok: true });
});
