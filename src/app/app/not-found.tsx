import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * A 404 raised inside the workspace keeps the sidebar, so the way out is one
 * click rather than a trip back through the root.
 */
export default function WorkspaceNotFound() {
  return (
    <div className="px-5 sm:px-8 py-10 max-w-[720px]">
      <div className="glass rounded-[16px] p-7">
        <span className="size-10 grid place-items-center rounded-[12px] glass-soft text-faint">
          <SearchX size={17} />
        </span>
        <h1 className="text-display text-[26px] mt-5 leading-tight">
          Not in this workspace
        </h1>
        <p className="text-[13.5px] text-mute mt-3 leading-[1.65] max-w-[54ch]">
          That project or clip was deleted, or it belongs to a workspace you are
          not a member of. Cutlist answers both the same way on purpose, so a
          stray link never reveals what exists elsewhere.
        </p>
        <div className="flex flex-wrap items-center gap-2.5 mt-6">
          <Link
            href="/app"
            className="h-9.5 px-4 inline-flex items-center rounded-[10px] bg-signal text-ink-950 text-[13.5px] font-semibold hover:bg-[#e2ff77] transition-colors"
          >
            Overview
          </Link>
          <Link
            href="/app/settings"
            className="h-9.5 px-4 inline-flex items-center rounded-[10px] border border-white/15 text-[13.5px] text-chalk-dim hover:text-chalk hover:border-white/25 transition-colors"
          >
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
