import { can, requireCtx } from "@/lib/tenancy";
import { libraryClips } from "@/lib/analysis/store";
import { ffmpegStatus } from "@/lib/analysis/ffmpeg";
import { LibraryView } from "@/components/LibraryView";

export const dynamic = "force-dynamic";

export const metadata = { title: "Clip library · Cutlist" };

export default async function LibraryPage() {
  const ctx = await requireCtx();
  return (
    <LibraryView
      clips={libraryClips(ctx)}
      ffmpeg={ffmpegStatus().ok}
      canRun={can.runAi(ctx.role)}
    />
  );
}
