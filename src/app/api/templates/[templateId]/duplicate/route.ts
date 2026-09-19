import { json, route } from "@/lib/api";
import { assert, can, requireCtx } from "@/lib/tenancy";
import { duplicateTemplate } from "@/lib/templates/store";

type Params = { params: Promise<{ templateId: string }> };

export const dynamic = "force-dynamic";

export const POST = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { templateId } = await params;
  assert(can.editBrief(ctx.role), "Only owners and creators can duplicate templates.");
  return json({ template: duplicateTemplate(ctx, templateId) });
});
