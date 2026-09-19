import { notFound } from "next/navigation";
import { can, HttpError, requireCtx } from "@/lib/tenancy";
import { getTemplate, listVersions } from "@/lib/templates/store";
import { TemplateEditor } from "@/components/templates/TemplateEditor";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ templateId: string }> };

export async function generateMetadata({ params }: Params) {
  try {
    const ctx = await requireCtx();
    const { templateId } = await params;
    return { title: `${getTemplate(ctx, templateId).name} · Cutlist` };
  } catch {
    return { title: "Template · Cutlist" };
  }
}

export default async function TemplatePage({ params }: Params) {
  const ctx = await requireCtx();
  const { templateId } = await params;

  try {
    const template = getTemplate(ctx, templateId);
    const versions = listVersions(ctx, templateId).map((v) => ({
      id: v.id,
      version: v.version,
      summary: v.summary,
      created_at: v.created_at,
    }));
    return (
      <TemplateEditor
        template={template}
        versions={versions}
        canEdit={can.editBrief(ctx.role)}
      />
    );
  } catch (err) {
    // A template id from another workspace must look identical to one that
    // never existed.
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
