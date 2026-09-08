import { notFound } from "next/navigation";
import { getProject, HttpError, requireCtx } from "@/lib/tenancy";
import { loadProjectDetail } from "@/lib/queries";
import { ProjectView } from "@/components/project/ProjectView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  try {
    const ctx = await requireCtx();
    const { projectId } = await params;
    return { title: getProject(ctx, projectId).name };
  } catch {
    return { title: "Project" };
  }
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireCtx();
  const { projectId } = await params;

  try {
    const project = getProject(ctx, projectId);
    return <ProjectView initial={loadProjectDetail(ctx, project)} />;
  } catch (err) {
    // A project id from another workspace must look identical to one that
    // never existed.
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
