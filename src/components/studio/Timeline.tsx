"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { labelStyle } from "@/lib/labelStyle";
import { timecode } from "@/lib/format";
import type { Label } from "@/lib/types";

/**
 * The timeline is the product in one control: every instruction the creator
 * spoke, sitting at the frame they spoke about, in the colour of its type.
 */
export function Timeline({
  durationMs,
  currentMs,
  labels,
  noteAnchors,
  onSeek,
  onPickLabel,
  activeLabelId,
}: {
  durationMs: number;
  currentMs: number;
  labels: Label[];
  noteAnchors: { id: string; at: number }[];
  onSeek: (ms: number) => void;
  onPickLabel?: (label: Label) => void;
  activeLabelId?: string | null;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const duration = durationMs > 0 ? durationMs : 0;
  const pct = (ms: number) => (duration ? Math.min(100, (ms / duration) * 100) : 0);

  const ticks = useMemo(() => {
    if (!duration) return [];
    // Aim for 6–10 labelled gridlines whatever the clip length.
    const targetCount = 8;
    const rawStep = duration / targetCount;
    const steps = [
      1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
      600_000, 900_000, 1_800_000,
    ];
    const step = steps.find((s) => s >= rawStep) ?? steps[steps.length - 1];
    const out: number[] = [];
    for (let t = step; t < duration; t += step) out.push(t);
    return out;
  }, [duration]);

  function msFromEvent(clientX: number): number {
    const el = track.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-eyebrow">Timeline</span>
        <span className="text-[10.5px] text-faint tabular">
          {labels.length} instruction{labels.length === 1 ? "" : "s"} ·{" "}
          {noteAnchors.length} note{noteAnchors.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        ref={track}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentMs}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, currentMs - 5000));
          if (e.key === "ArrowRight") onSeek(Math.min(duration, currentMs + 5000));
        }}
        onPointerDown={(e) => {
          if (!duration) return;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(msFromEvent(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!duration) return;
          const ms = msFromEvent(e.clientX);
          const rect = e.currentTarget.getBoundingClientRect();
          setHover({ x: e.clientX - rect.left, ms });
          if (dragging) onSeek(ms);
        }}
        onPointerUp={(e) => {
          setDragging(false);
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerLeave={() => setHover(null)}
        className={clsx(
          "relative h-[68px] rounded-[11px] glass-soft overflow-hidden",
          duration ? "cursor-pointer" : "cursor-default opacity-60",
        )}
      >
        {/* gridlines */}
        {ticks.map((tick) => (
          <div
            key={tick}
            className="absolute top-0 bottom-0 w-px bg-white/[0.05]"
            style={{ left: `${pct(tick)}%` }}
          >
            <span className="absolute top-1 left-1.5 text-[9px] tabular text-faint/70 whitespace-nowrap">
              {timecode(tick)}
            </span>
          </div>
        ))}

        {/* played region */}
        <div
          className="absolute inset-y-0 left-0 bg-signal/[0.055] pointer-events-none"
          style={{ width: `${pct(currentMs)}%` }}
        />

        {/* instruction markers */}
        <div className="absolute inset-x-0 top-[18px] h-[30px]">
          {labels.map((label) => {
            const style = labelStyle(label.type);
            const done = label.status === "done" || label.status === "skipped";
            const active = activeLabelId === label.id;
            const width = label.end_ms
              ? Math.max(0.4, pct(label.end_ms) - pct(label.start_ms))
              : null;

            return (
              <button
                key={label.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onPickLabel?.(label);
                  onSeek(label.start_ms);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title={`${timecode(label.start_ms)} · ${style.label} — ${label.title}`}
                className="absolute top-0 bottom-0 group"
                style={{
                  left: `${pct(label.start_ms)}%`,
                  width: width ? `${width}%` : "3px",
                  marginLeft: width ? 0 : "-1.5px",
                }}
              >
                {/* A range gets a translucent band with a solid in-point, so
                    overlapping ranges stay legible instead of becoming blobs. */}
                <span
                  className={clsx(
                    "block h-full rounded-[2px] transition-all duration-150",
                    done ? "opacity-30" : "opacity-95",
                    "group-hover:opacity-100",
                  )}
                  style={
                    width
                      ? {
                          background: `${style.color}2e`,
                          borderLeft: `2px solid ${style.color}`,
                          borderTop: `1px solid ${style.color}55`,
                          borderBottom: `1px solid ${style.color}55`,
                          boxShadow: active
                            ? `0 0 0 1px ${style.color}, 0 0 14px ${style.color}80`
                            : "none",
                        }
                      : {
                          background: style.color,
                          boxShadow: active
                            ? `0 0 0 1.5px ${style.color}, 0 0 14px ${style.color}`
                            : `0 0 8px ${style.color}70`,
                        }
                  }
                />
                {label.priority === "high" && !done ? (
                  <span
                    className="absolute -top-[5px] left-1/2 -translate-x-1/2 size-[4px] rounded-full"
                    style={{ background: style.color }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* voice-note anchors */}
        <div className="absolute inset-x-0 bottom-[7px] h-2">
          {noteAnchors.map((anchor) => (
            <span
              key={anchor.id}
              title={`Note at ${timecode(anchor.at)}`}
              className="absolute size-[5px] -translate-x-1/2 rounded-full bg-white/35"
              style={{ left: `${pct(anchor.at)}%` }}
            />
          ))}
        </div>

        {/* playhead */}
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-signal pointer-events-none"
          style={{
            left: `${pct(currentMs)}%`,
            boxShadow: "0 0 12px var(--color-signal)",
          }}
        >
          <span className="absolute -top-px -left-[3.25px] size-2 rounded-full bg-signal shadow-[0_0_10px_var(--color-signal)]" />
        </div>

        {/* hover readout */}
        {hover && duration ? (
          <>
            <div
              className="absolute top-0 bottom-0 w-px bg-white/25 pointer-events-none"
              style={{ left: hover.x }}
            />
            <span
              className="absolute bottom-1 -translate-x-1/2 rounded-md bg-ink-950/90 px-1.5 py-0.5 text-[10px] tabular text-chalk-dim pointer-events-none whitespace-nowrap"
              style={{
                left: Math.max(24, Math.min(hover.x, (track.current?.clientWidth ?? 0) - 24)),
              }}
            >
              {timecode(hover.ms, true)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
