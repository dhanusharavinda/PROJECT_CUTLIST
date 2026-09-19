import { can, requireCtx } from "@/lib/tenancy";
import { listTemplates } from "@/lib/templates/store";
import { TemplateLibrary } from "@/components/templates/TemplateLibrary";

export const dynamic = "force-dynamic";

export const metadata = { title: "Templates · Cutlist" };

export default async function TemplatesPage() {
  const ctx = await requireCtx();
  return (
    <TemplateLibrary
      templates={listTemplates(ctx)}
      canEdit={can.editBrief(ctx.role)}
    />
  );
}
