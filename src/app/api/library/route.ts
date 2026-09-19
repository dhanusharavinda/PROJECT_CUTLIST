import { json, route } from "@/lib/api";
import { requireCtx } from "@/lib/tenancy";
import { libraryClips } from "@/lib/analysis/store";
import { ffmpegStatus } from "@/lib/analysis/ffmpeg";

export const dynamic = "force-dynamic";

/** Every clip in the workspace with its tags, for searching across projects. */
export const GET = route(async () => {
  const ctx = await requireCtx();
  return json({ clips: libraryClips(ctx), ffmpeg: ffmpegStatus().ok });
});
