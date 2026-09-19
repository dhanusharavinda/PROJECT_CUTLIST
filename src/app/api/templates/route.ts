import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, can, getProject, requireCtx } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";
import {
  createTemplate,
  listTemplates,
  payloadFromProject,
} from "@/lib/templates/store";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireCtx();
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  return json({ templates: listTemplates(ctx, { includeArchived }) });
});

const Create = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(120),
  category: z.string().trim().max(60).optional(),
  description: z.string().trim().max(400).optional(),
  /** Either a payload, or a project to lift the settings from. */
  payload: z.unknown().optional(),
  fromProjectId: z.string().trim().min(1).optional(),
  summary: z.string().trim().max(200).optional(),
});

/** A new template, from scratch or from a project's current settings. */
export const POST = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.editBrief(ctx.role), "Only owners and creators can make templates.");

  const input = Create.parse(await body(req));
  const payload = input.fromProjectId
    ? payloadFromProject(ctx, getProject(ctx, input.fromProjectId).id)
    : (input.payload ?? {});

  const template = createTemplate(ctx, {
    name: input.name,
    category: input.category,
    description: input.description,
    payload,
    summary:
      input.summary ??
      (input.fromProjectId ? "Saved from a project" : "First version"),
  });

  logActivity({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    verb: "template.created",
    summary: `Template ${template.name} created`,
  });

  return json({ template });
});
