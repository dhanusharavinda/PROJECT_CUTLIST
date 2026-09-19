import { id, many, now, one, run, tx } from "../db";
import type { Ctx } from "../tenancy";
import { getProject, notFound } from "../tenancy";
import { completeness, nicheForCategory, sanitiseBrief, type BriefValues } from "../brief";
import { loadBrief } from "../queries";
import { recordEvent } from "../graph/events";

/**
 * Templates: reusable creative intent.
 *
 * A template is the brief's style and craft choices with a name on them. It is
 * never a copy of footage. Every edit makes a new version, and a project keeps
 * the id of the version it was created from, so tightening a template next
 * month cannot silently change a project you finished last week.
 */

export interface TemplatePayload {
  /** The brief fields, sanitised the same way the brief itself is. */
  brief: BriefValues;
  /** The planner preset, derived from the category unless set directly. */
  niche: string;
  /** The track direction the reel is usually cut to, if there is a habit. */
  music_note: string;
}

export interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  category: string;
  description: string;
  favourite: number;
  archived_at: number | null;
  current_version: number;
  usage_count: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface TemplateVersionRow {
  id: string;
  workspace_id: string;
  template_id: string;
  version: number;
  payload: string;
  summary: string;
  created_by: string | null;
  created_at: number;
}

export interface TemplateView {
  id: string;
  name: string;
  category: string;
  description: string;
  favourite: boolean;
  archived: boolean;
  current_version: number;
  version_id: string;
  usage_count: number;
  creator_name: string | null;
  created_at: number;
  updated_at: number;
  payload: TemplatePayload;
  /** The handful of settings a card shows without opening the template. */
  preview: { label: string; value: string }[];
}

const PREVIEW_KEYS: [string, string][] = [
  ["platform", "Platform"],
  ["aspect", "Aspect"],
  ["targetLength", "Length"],
  ["pacing", "Pacing"],
  ["shotDuration", "Shots"],
  ["hookStructure", "Hook"],
  ["transitions", "Transitions"],
  ["captions", "Captions"],
];

export function sanitisePayload(input: unknown): TemplatePayload {
  const raw = (input ?? {}) as Partial<TemplatePayload>;
  const brief = sanitiseBrief(raw.brief);
  const category = typeof brief.category === "string" ? brief.category : undefined;
  const niche =
    typeof raw.niche === "string" && raw.niche.trim()
      ? raw.niche.trim().slice(0, 40)
      : nicheForCategory(category);
  return {
    brief,
    niche,
    music_note: typeof raw.music_note === "string" ? raw.music_note.slice(0, 400) : "",
  };
}

function parsePayload(raw: string): TemplatePayload {
  try {
    return sanitisePayload(JSON.parse(raw));
  } catch {
    return { brief: {}, niche: "general", music_note: "" };
  }
}

function previewOf(payload: TemplatePayload): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const [key, label] of PREVIEW_KEYS) {
    const value = payload.brief[key];
    const text = Array.isArray(value) ? value.join(", ") : (value ?? "");
    if (text.trim()) out.push({ label, value: text.slice(0, 60) });
    if (out.length === 5) break;
  }
  return out;
}

function currentVersionRow(ctx: Ctx, template: TemplateRow): TemplateVersionRow | null {
  return one<TemplateVersionRow>(
    "SELECT * FROM template_versions WHERE workspace_id = ? AND template_id = ? AND version = ?",
    ctx.workspace.id,
    template.id,
    template.current_version,
  );
}

function view(ctx: Ctx, row: TemplateRow & { creator_name?: string | null }): TemplateView {
  const version = currentVersionRow(ctx, row);
  const payload = version ? parsePayload(version.payload) : { brief: {}, niche: "general", music_note: "" };
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    favourite: Boolean(row.favourite),
    archived: row.archived_at !== null,
    current_version: row.current_version,
    version_id: version?.id ?? "",
    usage_count: row.usage_count,
    creator_name: row.creator_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    payload,
    preview: previewOf(payload),
  };
}

export function listTemplates(
  ctx: Ctx,
  options: { includeArchived?: boolean } = {},
): TemplateView[] {
  const rows = many<TemplateRow & { creator_name: string | null }>(
    `SELECT t.*, u.name AS creator_name
       FROM templates t
       LEFT JOIN users u ON u.id = t.created_by
      WHERE t.workspace_id = ?${options.includeArchived ? "" : " AND t.archived_at IS NULL"}
      ORDER BY t.favourite DESC, t.updated_at DESC`,
    ctx.workspace.id,
  );
  return rows.map((row) => view(ctx, row));
}

export function getTemplate(ctx: Ctx, templateId: string): TemplateView {
  const row = one<TemplateRow & { creator_name: string | null }>(
    `SELECT t.*, u.name AS creator_name
       FROM templates t
       LEFT JOIN users u ON u.id = t.created_by
      WHERE t.id = ? AND t.workspace_id = ?`,
    templateId,
    ctx.workspace.id,
  );
  if (!row) throw notFound("Template not found in this workspace.");
  return view(ctx, row);
}

export function getTemplateVersion(
  ctx: Ctx,
  versionId: string,
): { version: TemplateVersionRow; payload: TemplatePayload; template: TemplateRow | null } | null {
  const version = one<TemplateVersionRow>(
    "SELECT * FROM template_versions WHERE id = ? AND workspace_id = ?",
    versionId,
    ctx.workspace.id,
  );
  if (!version) return null;
  const template = one<TemplateRow>(
    "SELECT * FROM templates WHERE id = ? AND workspace_id = ?",
    version.template_id,
    ctx.workspace.id,
  );
  return { version, payload: parsePayload(version.payload), template };
}

export function listVersions(ctx: Ctx, templateId: string): TemplateVersionRow[] {
  return many<TemplateVersionRow>(
    "SELECT * FROM template_versions WHERE workspace_id = ? AND template_id = ? ORDER BY version DESC",
    ctx.workspace.id,
    templateId,
  );
}

export function createTemplate(
  ctx: Ctx,
  input: {
    name: string;
    category?: string;
    description?: string;
    payload: unknown;
    summary?: string;
  },
): TemplateView {
  const payload = sanitisePayload(input.payload);
  const category =
    input.category?.trim() ||
    (typeof payload.brief.category === "string" ? payload.brief.category : "");
  const templateId = id("tpl");

  tx(() => {
    run(
      `INSERT INTO templates
         (id, workspace_id, name, category, description, favourite, archived_at, current_version,
          usage_count, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,0,NULL,1,0,?,?,?)`,
      templateId,
      ctx.workspace.id,
      input.name.trim().slice(0, 120),
      category.slice(0, 60),
      (input.description ?? "").trim().slice(0, 400),
      ctx.user.id,
      now(),
      now(),
    );
    run(
      `INSERT INTO template_versions (id, workspace_id, template_id, version, payload, summary, created_by, created_at)
       VALUES (?,?,?,1,?,?,?,?)`,
      id("tpv"),
      ctx.workspace.id,
      templateId,
      JSON.stringify(payload),
      (input.summary ?? "First version").slice(0, 200),
      ctx.user.id,
      now(),
    );
  });

  return getTemplate(ctx, templateId);
}

/** A new version. The old one stays, and every project made from it stays on it. */
export function addVersion(
  ctx: Ctx,
  templateId: string,
  payload: unknown,
  summary: string,
): TemplateView {
  const template = getTemplate(ctx, templateId);
  const next = template.current_version + 1;
  const clean = sanitisePayload(payload);
  const category = typeof clean.brief.category === "string" ? clean.brief.category : template.category;

  tx(() => {
    run(
      `INSERT INTO template_versions (id, workspace_id, template_id, version, payload, summary, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id("tpv"),
      ctx.workspace.id,
      templateId,
      next,
      JSON.stringify(clean),
      summary.trim().slice(0, 200) || `Version ${next}`,
      ctx.user.id,
      now(),
    );
    run(
      "UPDATE templates SET current_version = ?, category = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
      next,
      category.slice(0, 60),
      now(),
      templateId,
      ctx.workspace.id,
    );
  });

  return getTemplate(ctx, templateId);
}

export function updateTemplate(
  ctx: Ctx,
  templateId: string,
  changes: {
    name?: string;
    category?: string;
    description?: string;
    favourite?: boolean;
    archived?: boolean;
  },
): TemplateView {
  getTemplate(ctx, templateId);
  run(
    `UPDATE templates
        SET name = COALESCE(?, name),
            category = COALESCE(?, category),
            description = COALESCE(?, description),
            favourite = COALESCE(?, favourite),
            archived_at = CASE WHEN ? THEN ? ELSE archived_at END,
            updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
    changes.name?.trim().slice(0, 120) ?? null,
    changes.category?.trim().slice(0, 60) ?? null,
    changes.description?.trim().slice(0, 400) ?? null,
    changes.favourite === undefined ? null : changes.favourite ? 1 : 0,
    changes.archived !== undefined ? 1 : 0,
    changes.archived ? now() : null,
    now(),
    templateId,
    ctx.workspace.id,
  );
  return getTemplate(ctx, templateId);
}

export function duplicateTemplate(ctx: Ctx, templateId: string): TemplateView {
  const source = getTemplate(ctx, templateId);
  return createTemplate(ctx, {
    name: `${source.name} copy`,
    category: source.category,
    description: source.description,
    payload: source.payload,
    summary: `Copied from ${source.name} v${source.current_version}`,
  });
}

export function deleteTemplate(ctx: Ctx, templateId: string) {
  getTemplate(ctx, templateId);
  // Projects keep their template_version_id as a record of where they came
  // from; the version rows go with the template, so the link becomes a name.
  run("DELETE FROM templates WHERE id = ? AND workspace_id = ?", templateId, ctx.workspace.id);
}

/** What a project's current settings look like as a template. */
export function payloadFromProject(ctx: Ctx, projectId: string): TemplatePayload {
  const project = getProject(ctx, projectId);
  const brief = loadBrief(ctx, projectId);
  // Deadlines and per-project notes are not style; they would only mislead the
  // next project.
  const { deadline: _deadline, notes: _notes, ...reusable } = brief.payload;
  void _deadline;
  void _notes;
  return sanitisePayload({
    brief: reusable,
    niche: project.niche,
    music_note: project.music_note,
  });
}

/**
 * Apply a template to a project.
 *
 * Fill mode only writes fields the project has not set, so a template can be
 * dropped onto a half-written brief without losing anything. Overwrite mode is
 * for a fresh project. Either way the project records the exact version.
 */
export function applyTemplate(
  ctx: Ctx,
  projectId: string,
  templateId: string,
  mode: "fill" | "overwrite",
): { applied: number; version: number } {
  const project = getProject(ctx, projectId);
  const template = getTemplate(ctx, templateId);
  const current = loadBrief(ctx, projectId).payload;

  const next: BriefValues = mode === "overwrite" ? { ...current } : { ...current };
  let applied = 0;
  for (const [key, value] of Object.entries(template.payload.brief)) {
    const existing = current[key];
    const filled = Array.isArray(existing) ? existing.length > 0 : Boolean(existing && String(existing).trim());
    if (mode === "fill" && filled) continue;
    next[key] = value;
    applied += 1;
  }

  const values = sanitiseBrief(next);
  const score = completeness(values);

  tx(() => {
    run(
      `INSERT INTO briefs (project_id, workspace_id, payload, completeness, updated_by, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (project_id) DO UPDATE SET
         payload = excluded.payload,
         completeness = excluded.completeness,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      projectId,
      ctx.workspace.id,
      JSON.stringify(values),
      score,
      ctx.user.id,
      now(),
    );
    run(
      `UPDATE projects
          SET template_id = ?, template_version_id = ?,
              niche = CASE WHEN ? THEN ? ELSE niche END,
              music_note = CASE WHEN music_note = '' THEN ? ELSE music_note END,
              updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
      template.id,
      template.version_id,
      mode === "overwrite" || project.niche === "general" ? 1 : 0,
      template.payload.niche,
      template.payload.music_note,
      now(),
      projectId,
      ctx.workspace.id,
    );
    run(
      "UPDATE templates SET usage_count = usage_count + 1 WHERE id = ? AND workspace_id = ?",
      template.id,
      ctx.workspace.id,
    );
  });

  recordEvent(ctx, projectId, {
    kind: "template.applied",
    subjectType: "template",
    subjectId: template.id,
    payload: { version: template.current_version, mode, applied },
  });

  return { applied, version: template.current_version };
}
