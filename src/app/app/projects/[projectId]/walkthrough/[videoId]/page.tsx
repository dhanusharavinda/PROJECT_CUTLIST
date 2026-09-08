import { notFound } from "next/navigation";
import { getProject, getVideo, HttpError, requireCtx } from "@/lib/tenancy";
import { loadProjectDetail } from "@/lib/queries";
import { Walkthrough } from "@/components/walkthrough/Walkthrough";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  try {
    const ctx = await requireCtx();
    const { videoId } = await params;
    return { title: `${getVideo(ctx, videoId).title} · Walkthrough` };
  } catch {
    return { title: "Walkthrough" };
  }
}

export default async function WalkthroughPage({
  params,
}: {
  params: Promise<{ projectId: string; videoId: string }>;
}) {
  const ctx = await requireCtx();
  const { projectId, videoId } = await params;

  try {
    const project = getProject(ctx, projectId);
    const video = getVideo(ctx, videoId);
    // Both belong to this workspace; make sure they belong to each other too.
    if (video.project_id !== project.id) notFound();

    return <Walkthrough initial={loadProjectDetail(ctx, project)} videoId={videoId} />;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
