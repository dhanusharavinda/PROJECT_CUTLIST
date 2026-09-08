"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Errors inside the workspace keep the sidebar, so the user can still navigate
 * somewhere useful instead of being thrown out to a blank page.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[cutlist] workspace error:", error);
  }, [error]);

  return (
    <div className="px-5 sm:px-8 py-10 max-w-[720px]">
      <div className="glass rounded-[16px] p-7">
        <span className="text-eyebrow">This screen</span>
        <h1 className="text-display text-[26px] mt-2.5 leading-tight">
          Couldn&rsquo;t load
        </h1>
        <p className="text-[13.5px] text-mute mt-3 leading-[1.65] max-w-[54ch]">
          Something failed while building this view. Your projects, notes and
          cut list are stored on disk and are not affected — everything else in
          the sidebar still works.
        </p>

        <div className="flex flex-wrap items-center gap-2.5 mt-6">
          <button
            onClick={reset}
            className="h-9.5 px-4 inline-flex items-center gap-2 rounded-[10px] bg-signal text-ink-950 text-[13.5px] font-semibold hover:bg-[#e2ff77] transition-colors"
          >
            <RefreshCw size={14} />
            Try again
          </button>
          <Link
            href="/app"
            className="h-9.5 px-4 inline-flex items-center rounded-[10px] border border-white/15 text-[13.5px] text-chalk-dim hover:text-chalk hover:border-white/25 transition-colors"
          >
            Overview
          </Link>
        </div>

        {error.message ? (
          <details className="mt-7">
            <summary className="text-[11.5px] text-faint cursor-pointer hover:text-mute list-none select-none">
              Technical detail
            </summary>
            <pre className="mt-2 text-[11px] text-faint leading-relaxed whitespace-pre-wrap break-words rounded-[10px] bg-white/[0.03] border border-white/[0.07] p-3 max-h-[9rem] overflow-auto">
              {error.message}
              {error.digest ? `\ndigest: ${error.digest}` : ""}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
