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
  searchParams,
}: {
  params: Promise<{ projectId: string; videoId: string }>;
  searchParams: Promise<{ t?: string | string[]; note?: string | string[] }>;
}) {
  const ctx = await requireCtx();
  const { projectId, videoId } = await params;
  const query = await searchParams;

  // `?t=<ms>` and `?note=<id>` let other pages open a clip at an exact moment.
  const rawT = Array.isArray(query.t) ? query.t[0] : query.t;
  const t = rawT === undefined || rawT === "" ? NaN : Number(rawT);
  const initialMs = Number.isFinite(t) && t >= 0 ? Math.round(t) : null;
  const rawNote = Array.isArray(query.note) ? query.note[0] : query.note;
  const initialNoteId = rawNote ? rawNote : null;

  try {
    const project = getProject(ctx, projectId);
    const video = getVideo(ctx, videoId);
    // Both belong to this workspace; make sure they belong to each other too.
    if (video.project_id !== project.id) notFound();

    return (
      <Walkthrough
        initial={loadProjectDetail(ctx, project)}
        videoId={videoId}
        initialMs={initialMs}
        initialNoteId={initialNoteId}
      />
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
