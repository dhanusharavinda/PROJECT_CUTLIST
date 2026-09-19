"use client";

import clsx from "clsx";
import { timecode } from "@/lib/format";
import type { ReelSlotView } from "@/lib/reel/types";

/**
 * The whole reel, drawn once.
 *
 * This is the only place every slot is visible at the same time: one block per
 * slot, as wide as it is long, its own frame showing through underneath. It is
 * a map, not an editor. The only interaction is "take me there".
 */
export function ReelRibbon({
  slots,
  activeIdx,
  playheadMs,
  onPick,
  className,
}: {
  slots: ReelSlotView[];
  activeIdx: number;
  /** Where the playhead sits in reel time, for the one moving line. */
  playheadMs: number;
  onPick: (idx: number) => void;
  className?: string;
}) {
  if (slots.length === 0) return null;

  const total = slots.reduce((sum, slot) => sum + Math.max(1, slot.hold_ms), 0);
  const playheadPct =
    total > 0 ? Math.max(0, Math.min(100, (playheadMs / total) * 100)) : 0;

  return (
    <div className={clsx("relative", className)}>
      <div className="flex h-[26px] gap-[2px]" role="group" aria-label="The whole reel">
        {slots.map((slot, idx) => {
          const name = slot.title ?? slot.source_name;
          const poster =
            slot.frame_idx !== null && !slot.missing
              ? `/api/videos/${slot.video_id}/frames/${slot.frame_idx}`
              : null;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onPick(idx)}
              aria-current={idx === activeIdx ? "true" : undefined}
              aria-label={`Slot ${idx + 1}, ${name}, ${(slot.hold_ms / 1000).toFixed(1)} seconds`}
              title={`${idx + 1}. ${name} at ${timecode(slot.reel_start_ms)}`}
              style={{ flexGrow: Math.max(1, slot.hold_ms), flexBasis: 0 }}
              className={clsx(
                "relative min-w-[7px] overflow-hidden rounded-[4px] border transition-colors",
                "grid place-items-center",
                slot.missing
                  ? "border-danger/55 bg-danger/12"
                  : idx === activeIdx
                    ? "border-signal ring-1 ring-signal/60 bg-white/[0.08]"
                    : "border-white/[0.09] bg-white/[0.04] hover:border-white/25",
              )}
            >
              {poster ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={poster}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover opacity-30"
                />
              ) : null}
              <span
                className={clsx(
                  "relative tabular text-[9.5px] leading-none",
                  idx === activeIdx ? "text-chalk" : "text-chalk-dim",
                )}
              >
                {idx + 1}
              </span>
            </button>
          );
        })}
      </div>

      {/* One moving line, so "where am I" needs no number. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-px bg-signal"
        style={{ left: `${playheadPct}%`, boxShadow: "0 0 8px rgba(214,245,94,.7)" }}
      />
    </div>
  );
}
