import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, many, now, run, tx } from "@/lib/db";
import { assert, can, requireCtx } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";
import { applyTemplate, getTemplate } from "@/lib/templates/store";
import { recordEvent } from "@/lib/graph/events";

export const GET = route(async () => {
  const ctx = await requireCtx();

  const projects = many<{
    id: string;
    name: string;
    summary: string;
    status: string;
    due_at: number | null;
    updated_at: number;
    created_at: number;
    video_count: number;
    label_count: number;
    open_count: number;
    note_count: number;
    completeness: number;
  }>(
    `SELECT p.id, p.name, p.summary, p.status, p.due_at, p.updated_at, p.created_at,
            (SELECT COUNT(*) FROM videos v WHERE v.project_id = p.id) AS video_count,
            (SELECT COUNT(*) FROM labels l WHERE l.project_id = p.id) AS label_count,
            (SELECT COUNT(*) FROM labels l WHERE l.project_id = p.id AND l.status IN ('open','doing')) AS open_count,
            (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id) AS note_count,
            COALESCE((SELECT b.completeness FROM briefs b WHERE b.project_id = p.id), 0) AS completeness
       FROM projects p
      WHERE p.workspace_id = ?
      ORDER BY CASE p.status WHEN 'archived' THEN 1 ELSE 0 END, p.updated_at DESC`,
    ctx.workspace.id,
  );

  return json({ projects, role: ctx.role });
});

const Create = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  summary: z.string().trim().max(600).optional(),
  dueAt: z.number().int().positive().nullable().optional(),
  /** Start from a saved template instead of an empty brief. */
  templateId: z.string().trim().min(1).optional(),
});

export const POST = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.createProject(ctx.role), "Only owners and creators can start a project.");

  const input = Create.parse(await body(req));
  const projectId = id("prj");

  tx(() => {
    run(
      `INSERT INTO projects (id, workspace_id, name, summary, status, due_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      projectId,
      ctx.workspace.id,
      input.name,
      input.summary ?? "",
      "briefing",
      input.dueAt ?? null,
      ctx.user.id,
      now(),
      now(),
    );
    run(
      "INSERT INTO briefs (project_id, workspace_id, payload, completeness, updated_by, updated_at) VALUES (?,?,?,?,?,?)",
      projectId,
      ctx.workspace.id,
      "{}",
      0,
      ctx.user.id,
      now(),
    );
  });

  // The template pre-fills the brief and pins the exact version, so editing
  // the template later cannot reach into this project.
  let fromTemplate: string | null = null;
  if (input.templateId) {
    const template = getTemplate(ctx, input.templateId);
    applyTemplate(ctx, projectId, template.id, "overwrite");
    fromTemplate = template.name;
  }

  recordEvent(ctx, projectId, {
    kind: "project.created",
    payload: { template: fromTemplate },
  });

  logActivity({
    workspaceId: ctx.workspace.id,
    projectId,
    actorId: ctx.user.id,
    verb: "project.created",
    summary: fromTemplate ? `${input.name} created from ${fromTemplate}` : `${input.name} created`,
  });

  return json({ id: projectId });
});
