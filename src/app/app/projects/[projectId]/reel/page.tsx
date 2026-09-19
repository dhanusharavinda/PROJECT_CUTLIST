import { notFound } from "next/navigation";
import { getProject, HttpError, requireCtx } from "@/lib/tenancy";
import { loadProjectDetail } from "@/lib/queries";
import { ReelBoard } from "@/components/reel/ReelBoard";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  try {
    const ctx = await requireCtx();
    const { projectId } = await params;
    return { title: `${getProject(ctx, projectId).name} · Reel` };
  } catch {
    return { title: "Reel" };
  }
}

export default async function ReelPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireCtx();
  const { projectId } = await params;

  try {
    const project = getProject(ctx, projectId);
    return <ReelBoard initial={loadProjectDetail(ctx, project)} />;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
