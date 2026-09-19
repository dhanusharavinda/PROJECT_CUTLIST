import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, can, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { applyTemplate, getTemplate } from "@/lib/templates/store";
import { loadProjectDetail } from "@/lib/queries";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

const Apply = z.object({
  templateId: z.string().trim().min(1),
  /** fill: only empty fields. overwrite: the template wins everywhere. */
  mode: z.enum(["fill", "overwrite"]).default("fill"),
});

/** Drop a template onto an existing project. */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.editBrief(ctx.role), "Only owners and creators can apply a template.");

  const input = Apply.parse(await body(req));
  const template = getTemplate(ctx, input.templateId);
  const result = applyTemplate(ctx, projectId, template.id, input.mode);

  emit(
    ctx.workspace.id,
    { type: "brief", projectId, payload: { template: template.id } },
    {
      actorId: ctx.user.id,
      verb: "template.applied",
      summary: `${template.name} v${result.version} applied to ${project.name} (${result.applied} field${result.applied === 1 ? "" : "s"})`,
    },
  );

  return json({ ...result, detail: loadProjectDetail(ctx, getProject(ctx, projectId)) });
});
