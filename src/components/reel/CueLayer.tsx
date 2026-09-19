"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { timecode } from "@/lib/format";
import { labelStyle } from "@/lib/labelStyle";
import { activeAt, LINGER_MS, spanOf } from "@/lib/reel/time";
import type { Label } from "@/lib/types";

/**
 * Instructions that float over the picture, one at a time.
 *
 * The rule the whole layer obeys: nothing appears unless it is true at this
 * exact moment. Between instructions the frame is clean. The layer itself is
 * pointer-events-none so clicking the video still plays and pauses it; only the
 * card takes clicks.
 */

const CUES_KEY = "cutlist:cues";
const SAFE_KEY = "cutlist:safe";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* a private window is not a reason to break the overlay */
  }
}

function typingInto(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

export function CueLayer({
  labels,
  currentMs,
  /** Hidden while the creator is talking: they are speaking, not reading. */
  muted = false,
  className,
}: {
  labels: Label[];
  currentMs: number;
  muted?: boolean;
  className?: string;
}) {
  const [cues, setCues] = useState(true);
  const [safe, setSafe] = useState(false);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const [lingering, setLingering] = useState<Label | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // localStorage is not available while rendering on the server.
  useEffect(() => {
    setCues(readFlag(CUES_KEY, true));
    setSafe(readFlag(SAFE_KEY, false));
  }, []);

  const live = useMemo(() => activeAt(labels, currentMs), [labels, currentMs]);
  const current = live.length > 0 ? live[pick % live.length] : null;
  const headId = live[0]?.id ?? null;

  // A new moment starts from the top, folded.
  useEffect(() => {
    setPick(0);
    setOpen(false);
  }, [headId, live.length]);

  /** The card outlives its span briefly, so a fast cut is still readable. */
  useEffect(() => {
    if (current) {
      setLingering(current);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    if (!lingering) return;
    timer.current = setTimeout(() => setLingering(null), LINGER_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [current, lingering]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInto(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "i") {
        event.preventDefault();
        setCues((value) => {
          writeFlag(CUES_KEY, !value);
          return !value;
        });
      }
      if (key === "g") {
        event.preventDefault();
        setSafe((value) => {
          writeFlag(SAFE_KEY, !value);
          return !value;
        });
      }
      if (key === "o") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = cues && !muted ? (current ?? lingering) : null;
  const style = shown ? labelStyle(shown.type) : null;
  const span = shown ? spanOf(shown) : null;
  const extra = live.length - 1;

  return (
    <div
      className={clsx("absolute inset-0 pointer-events-none select-none", className)}
      aria-hidden={!shown}
    >
      {/* Instagram covers these edges with its own controls. */}
      {safe ? (
        <>
          <span className="absolute inset-x-0 top-[10%] border-t border-dashed border-white/25" />
          <span className="absolute inset-x-0 bottom-[20%] border-t border-dashed border-white/25" />
          <span className="absolute inset-y-0 right-[15%] border-l border-dashed border-white/20" />
          <span className="absolute left-2 top-[10%] mt-1 text-[9px] uppercase tracking-wider text-white/45">
            safe area
          </span>
        </>
      ) : null}

      {shown && style && span ? (
        <div
          className={clsx(
            "absolute left-3 bottom-3 max-w-[66%] pointer-events-auto",
            current ? "animate-rise" : "animate-fade opacity-75",
          )}
        >
          <div className="glass-deep rounded-[11px] px-2.5 py-2 flex items-start gap-2">
            <span
              className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] leading-none"
              style={{
                color: style.color,
                background: `${style.color}1f`,
                border: `1px solid ${style.color}45`,
              }}
              aria-hidden
            >
              {style.glyph}
            </span>

            <div className="min-w-0">
              <p className="text-[9.5px] uppercase tracking-wider" style={{ color: style.color }}>
                {style.label}
                <span className="text-faint tabular normal-case tracking-normal ml-1.5">
                  {timecode(span.start_ms)}
                  {shown.end_ms ? ` to ${timecode(shown.end_ms)}` : ""}
                </span>
              </p>

              <p
                className={clsx(
                  "text-[12.5px] leading-snug mt-0.5",
                  shown.status === "done" ? "text-mute line-through" : "text-chalk",
                )}
              >
                {shown.title}
              </p>

              {open && shown.detail ? (
                <p className="text-[11.5px] text-mute leading-relaxed mt-1 max-w-[46ch]">
                  {shown.detail}
                </p>
              ) : null}

              <div className="flex items-center gap-2 mt-1">
                {shown.detail ? (
                  <button
                    onClick={() => setOpen((value) => !value)}
                    className="text-[10.5px] text-faint hover:text-chalk-dim transition-colors"
                  >
                    {open ? "less" : "more"}
                  </button>
                ) : null}

                {extra > 0 ? (
                  <button
                    onClick={() => setPick((value) => value + 1)}
                    title="Cycle the instructions at this moment"
                    className="rounded-full border border-white/15 px-1.5 text-[10px] tabular text-mute hover:text-chalk hover:border-white/30 transition-colors"
                  >
                    +{extra}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
