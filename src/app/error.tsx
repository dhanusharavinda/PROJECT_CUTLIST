"use client";

import { useEffect } from "react";
import { FallbackLink, FullPageState } from "@/components/Fallback";

/**
 * Catches anything thrown while rendering a route. The message is shown only
 * behind a disclosure — the headline stays in plain language.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[cutlist] render error:", error);
  }, [error]);

  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <FullPageState
      eyebrow="Something broke"
      title={offline ? "You are offline" : "That screen failed to load"}
      body={
        offline
          ? "Cutlist runs on your own machine, so this is usually the dev server having stopped rather than the internet. Check the terminal you started it in, then try again."
          : "The page hit an error on the way in. Nothing you had saved is affected — projects, notes and the cut list are written to disk as you go."
      }
      actions={
        <>
          <button
            onClick={reset}
            className="h-10 px-4 inline-flex items-center rounded-[10px] bg-signal text-ink-950 text-[13.5px] font-semibold hover:bg-[#e2ff77] transition-colors"
          >
            Try again
          </button>
          <FallbackLink href="/app">Back to your workspace</FallbackLink>
        </>
      }
      detail={[error.message, error.digest && `digest: ${error.digest}`]
        .filter(Boolean)
        .join("\n")}
    />
  );
}
