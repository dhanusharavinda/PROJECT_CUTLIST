import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, can, requireCtx } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";
import {
  deleteTemplate,
  getTemplate,
  listVersions,
  updateTemplate,
} from "@/lib/templates/store";

type Params = { params: Promise<{ templateId: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { templateId } = await params;
  return json({
    template: getTemplate(ctx, templateId),
    versions: listVersions(ctx, templateId).map((v) => ({
      id: v.id,
      version: v.version,
      summary: v.summary,
      created_at: v.created_at,
    })),
  });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(60).optional(),
  description: z.string().trim().max(400).optional(),
  favourite: z.boolean().optional(),
  archived: z.boolean().optional(),
});

/** Rename, recategorise, favourite, archive or restore. Content changes are versions. */
export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { templateId } = await params;
  assert(can.editBrief(ctx.role), "Only owners and creators can change templates.");

  const changes = Patch.parse(await body(req));
  const template = updateTemplate(ctx, templateId, changes);

  if (changes.archived !== undefined) {
    logActivity({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      verb: changes.archived ? "template.archived" : "template.restored",
      summary: `Template ${template.name} ${changes.archived ? "archived" : "restored"}`,
    });
  }

  return json({ template });
});

export const DELETE = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { templateId } = await params;
  assert(can.editBrief(ctx.role), "Only owners and creators can delete templates.");

  const template = getTemplate(ctx, templateId);
  deleteTemplate(ctx, templateId);

  logActivity({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    verb: "template.deleted",
    summary: `Template ${template.name} deleted`,
  });

  return json({ ok: true });
});
