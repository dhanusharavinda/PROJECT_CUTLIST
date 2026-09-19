"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { labelStyle } from "@/lib/labelStyle";
import { nearestAt } from "@/lib/reel/time";
import { timecode } from "@/lib/format";
import type { Label } from "@/lib/types";

/**
 * A marker track over a reference clip, NOT an edit timeline.
 *
 * Nothing here modifies media. It is a read-only time axis showing where each
 * spoken instruction landed, so "where" is a click instead of a sentence. The
 * only interactions are seek and select.
 */
export function Timeline({
  durationMs,
  currentMs,
  labels,
  noteAnchors,
  onSeek,
  onPickLabel,
  activeLabelId,
  onPickNote,
  activeNoteId,
  scenes,
  beats,
}: {
  durationMs: number;
  currentMs: number;
  labels: Label[];
  noteAnchors: { id: string; at: number }[];
  onSeek: (ms: number) => void;
  onPickLabel?: (label: Label) => void;
  activeLabelId?: string | null;
  /** A note dot was clicked: open that note at its moment. */
  onPickNote?: (noteId: string, at: number) => void;
  activeNoteId?: string | null;
  /** Shot boundaries found by the analyser. */
  scenes?: number[];
  /** Beat grid from the music, when the track has a steady tempo. */
  beats?: number[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const duration = durationMs > 0 ? durationMs : 0;
  const pct = (ms: number) => (duration ? Math.min(100, (ms / duration) * 100) : 0);

  // Eight pixels of slack, in milliseconds at the current track width.
  const hoverTolerance =
    duration && track.current?.clientWidth
      ? (8 / track.current.clientWidth) * duration
      : 0;
  const hoveredLabel = hover ? nearestAt(labels, hover.ms, hoverTolerance) : null;

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
    <div className="relative select-none">
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-eyebrow">Markers</span>
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

        {/* beat grid, from the analysed soundtrack */}
        {beats && beats.length > 1 && duration ? (
          <div className="absolute inset-x-0 top-0 h-3 pointer-events-none">
            {beats.slice(0, 600).map((beat) =>
              beat > duration ? null : (
                <span
                  key={beat}
                  className="absolute top-0 w-px h-[5px] bg-signal/25"
                  style={{ left: `${pct(beat)}%` }}
                />
              ),
            )}
          </div>
        ) : null}

        {/* where the clip already cuts */}
        {scenes && scenes.length > 1 && duration ? (
          <div className="absolute inset-0 pointer-events-none">
            {scenes.slice(0, 300).map((at) =>
              at <= 0 || at > duration ? null : (
                <span
                  key={at}
                  className="absolute top-[13px] bottom-[17px] w-px bg-white/[0.14]"
                  style={{ left: `${pct(at)}%` }}
                />
              ),
            )}
          </div>
        ) : null}

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
                aria-label={`${timecode(label.start_ms)} · ${style.label}: ${label.title}`}
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
        <div className="absolute inset-x-0 bottom-[3px] h-4">
          {noteAnchors.map((anchor) => {
            const active = activeNoteId === anchor.id;
            return (
              <button
                key={anchor.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onPickNote) onPickNote(anchor.id, anchor.at);
                  else onSeek(anchor.at);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title={`Voice note at ${timecode(anchor.at)}`}
                aria-label={`Open the voice note at ${timecode(anchor.at)}`}
                className="absolute top-0 h-4 w-3 -translate-x-1/2 grid place-items-center group"
                style={{ left: `${pct(anchor.at)}%` }}
              >
                <span
                  className={clsx(
                    "block rounded-full transition-all duration-150",
                    active
                      ? "size-[7px] bg-signal shadow-[0_0_8px_var(--color-signal)]"
                      : "size-[5px] bg-white/35 group-hover:size-[7px] group-hover:bg-white/80",
                  )}
                />
              </button>
            );
          })}
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

      {/* What sits under the pointer, drawn outside the clipped track. */}
      {hover && hoveredLabel ? (
        <span
          className="pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full inline-flex items-center gap-1.5 whitespace-nowrap rounded-md glass-deep px-2 py-1 text-[11px]"
          style={{
            left: Math.max(
              70,
              Math.min(hover.x, (track.current?.clientWidth ?? 0) - 70),
            ),
          }}
        >
          <span aria-hidden style={{ color: labelStyle(hoveredLabel.type).color }}>
            {labelStyle(hoveredLabel.type).glyph}
          </span>
          <span className="text-chalk-dim max-w-[38ch] truncate">
            {hoveredLabel.title}
          </span>
        </span>
      ) : null}
    </div>
  );
}
