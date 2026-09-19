"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Copy,
  Film,
  Pause,
  Play,
  Scissors,
  Send,
  SkipBack,
  SkipForward,
  Trash2,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  Button,
  Empty,
  Meter,
  Segmented,
  Spinner,
  useToast,
} from "@/components/ui";
import { FilmstripArt } from "@/components/EmptyArt";
import { timecode } from "@/lib/format";
import { spanOf } from "@/lib/reel/time";
import type { ProjectDetail } from "@/lib/queries";
import type { AnalysisPayload } from "@/lib/analysis/types";
import type { Label } from "@/lib/types";
import type { ReelSlotView, ReelView, SlotInput } from "@/lib/reel/types";
import { api, useProject } from "@/components/project/useProject";
import { CueLayer } from "@/components/reel/CueLayer";
import { ReelRibbon } from "@/components/reel/ReelRibbon";
import { PacketSheet } from "@/components/reel/PacketSheet";

/**
 * The reel: the order the clips play in, and nothing else.
 *
 * This screen produces information, never media. It plays the footage back in
 * the chosen order so the creator can see the reel before an editor touches it,
 * and every edit here is a change to a list of in and out points.
 *
 * The one number on the page is the runtime against the target. Shot counts,
 * tempo and motion all exist in the analyser; none of them belong here, because
 * the decision this screen supports is only "does this play well, in this
 * order, at this length".
 */

/** The server caps the reel at this many slots; the UI stops before it does. */
const MAX_SLOTS = 60;
/** Quiet autosave: one PUT after the creator stops fiddling. */
const SAVE_DELAY_MS = 600;
/** How close to a detected cut still counts as landing on it. */
const SNAP_MS = 400;
/** A slot shorter than this is a glitch, not a shot. */
const MIN_SLOT_MS = 300;
/**
 * What we can honestly claim about a trim point. Shot boundaries come from the
 * analyser's sampled decode and the player's clock is no better, so the number
 * printed in the inspector is this, not a frame count.
 */
const TRIM_ACCURACY_MS = 200;
/** A clip that has not progressed in this long is not going to play. */
const STALL_MS = 5000;
const MUTE_KEY = "cutlist:reel-muted";

type Deck = 0 | 1;

function toInput(slot: ReelSlotView): SlotInput {
  return {
    videoId: slot.video_id,
    inMs: Math.round(slot.in_ms),
    outMs: Math.round(slot.out_ms),
    note: slot.note,
    snap: slot.snap,
  };
}

/** Re-derive everything that follows from the order, so the UI never lags. */
function withSlots(reel: ReelView, slots: ReelSlotView[]): ReelView {
  let start = 0;
  const laid = slots.map((slot, idx) => {
    const hold = Math.max(0, Math.round(slot.out_ms - slot.in_ms));
    const next: ReelSlotView = {
      ...slot,
      idx,
      hold_ms: hold,
      reel_start_ms: start,
    };
    start += hold;
    return next;
  });
  const holds = laid.map((slot) => slot.hold_ms).sort((a, b) => a - b);

  return {
    ...reel,
    slots: laid,
    total_ms: start,
    shots: laid.length,
    median_hold_ms: holds.length ? holds[Math.floor(holds.length / 2)] : 0,
  };
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

/** A focused button owns Enter and Space; the board must not steal them. */
function isControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "BUTTON" ||
    el.tagName === "A" ||
    el.getAttribute("role") === "button"
  );
}

export function ReelBoard({ initial }: { initial: ProjectDetail }) {
  const toast = useToast();
  const { project: state } = useProject(initial);
  const projectId = state.project.id;

  const [reel, setReel] = useState<ReelView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [packetOpen, setPacketOpen] = useState(false);

  const [activeIdx, setActiveIdx] = useState(0);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [seekTick, setSeekTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentMs, setCurrentMs] = useState(0);
  const [videoRatio, setVideoRatio] = useState<number | null>(null);
  /** Clips the browser refused to play: those slots flip as stills instead. */
  const [noPlay, setNoPlay] = useState<string[]>([]);
  const [fetchedAnalysis, setFetchedAnalysis] = useState<
    Record<string, AnalysisPayload | null>
  >({});

  const [deck, setDeck] = useState<Deck>(0);
  const [srcIds, setSrcIds] = useState<[string | null, string | null]>([null, null]);

  const deckA = useRef<HTMLVideoElement>(null);
  const deckB = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<[number | null, number | null]>([null, null]);
  const armed = useRef<string | null>(null);
  const controls = useRef(new Map<string, HTMLElement | null>());
  const focusAfter = useRef<string | null>(null);
  const localSeq = useRef(1);
  const pending = useRef<ReelView | null>(null);
  const revision = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalledSince = useRef<{ ms: number; at: number } | null>(null);
  const warnedNoPlay = useRef(false);

  const slots = reel?.slots ?? [];
  const slot = slots[activeIdx] ?? null;
  const footage = useMemo(
    () => state.videos.filter((video) => video.role !== "reference"),
    [state.videos],
  );

  const deckEl = useCallback(
    (which: Deck) => (which === 0 ? deckA.current : deckB.current),
    [],
  );

  const registerControl = useCallback((key: string, el: HTMLElement | null) => {
    controls.current.set(key, el);
  }, []);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api<{ reel: ReelView }>(`/api/projects/${projectId}/reel`);
        if (!alive) return;
        pending.current = res.reel;
        setReel(res.reel);
      } catch (err) {
        if (alive) setLoadError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Muting is a per-viewer convenience, so it is the one thing kept locally.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MUTE_KEY);
      if (raw !== null) setMuted(raw === "1");
    } catch {
      /* a private window is not a reason to break playback */
    }
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────

  const flush = useCallback(async () => {
    const snapshot = pending.current;
    if (!snapshot) return;
    const rev = revision.current;
    setSaving(true);
    try {
      const res = await api<{ reel: ReelView }>(`/api/projects/${projectId}/reel`, {
        method: "PUT",
        json: { items: snapshot.slots.map(toInput) },
      });
      setSavedOnce(true);
      // Anything typed while this was in flight has already queued its own
      // save, so adopting the server's answer now would undo it.
      if (revision.current === rev) {
        pending.current = res.reel;
        setReel(res.reel);
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }, [projectId, toast]);

  const apply = useCallback(
    (nextSlots: ReelSlotView[], focus?: string) => {
      if (!reel) return;
      const next = withSlots(reel, nextSlots);
      pending.current = next;
      revision.current += 1;
      if (focus) focusAfter.current = focus;
      setReel(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void flush();
      }, SAVE_DELAY_MS);
    },
    [reel, flush],
  );

  // Leaving the page mid-debounce must not lose the last move.
  useEffect(
    () => () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      const snapshot = pending.current;
      if (!snapshot) return;
      void fetch(`/api/projects/${projectId}/reel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: snapshot.slots.map(toInput) }),
        keepalive: true,
      }).catch(() => {});
    },
    [projectId],
  );

  // A reorder moves the button out from under the pointer; put focus back on
  // the control the creator was pressing, at its new position.
  useEffect(() => {
    const key = focusAfter.current;
    if (!key) return;
    focusAfter.current = null;
    controls.current.get(key)?.focus();
  }, [reel]);

  useEffect(() => {
    controls.current.get(`${activeIdx}:card`)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // ── Edits ─────────────────────────────────────────────────────────────────

  const setActive = useCallback((idx: number) => {
    setActiveIdx((current) => (current === idx ? current : idx));
  }, []);

  const jumpTo = useCallback((idx: number) => {
    setActiveIdx(idx);
    setSeekTick((tick) => tick + 1);
  }, []);

  const move = useCallback(
    (idx: number, delta: number) => {
      const target = idx + delta;
      if (target < 0 || target >= slots.length) return;
      const next = [...slots];
      const held = next[idx];
      next[idx] = next[target];
      next[target] = held;
      setActiveIdx(target);
      apply(next, `${target}:${delta < 0 ? "up" : "down"}`);
    },
    [slots, apply],
  );

  const duplicate = useCallback(
    (idx: number) => {
      if (slots.length >= MAX_SLOTS) {
        toast(`A reel holds ${MAX_SLOTS} slots. Remove one first.`, "error");
        return;
      }
      const source = slots[idx];
      if (!source) return;
      const copy: ReelSlotView = { ...source, id: `local-${localSeq.current++}` };
      const next = [...slots.slice(0, idx + 1), copy, ...slots.slice(idx + 1)];
      setActiveIdx(idx + 1);
      apply(next, `${idx + 1}:duplicate`);
    },
    [slots, apply, toast],
  );

  const remove = useCallback(
    (idx: number) => {
      if (!slots[idx]) return;
      const next = slots.filter((_, at) => at !== idx);
      const active = Math.max(0, Math.min(idx, next.length - 1));
      setActiveIdx(active);
      setOpenIdx(null);
      apply(next, next.length ? `${active}:remove` : undefined);
    },
    [slots, apply],
  );

  const trim = useCallback(
    (idx: number, inMs: number, outMs: number, snap: ReelSlotView["snap"]) => {
      const next = slots.map((entry, at) =>
        at === idx ? { ...entry, in_ms: inMs, out_ms: outMs, snap } : entry,
      );
      apply(next);
    },
    [slots, apply],
  );

  async function seed() {
    setSeeding(true);
    try {
      const res = await api<{ reel: ReelView }>(
        `/api/projects/${projectId}/reel/seed`,
        { method: "POST" },
      );
      pending.current = res.reel;
      setReel(res.reel);
      setActiveIdx(0);
      setLoadError(null);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSeeding(false);
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  const still = Boolean(slot && (slot.missing || noPlay.includes(slot.video_id)));

  const seekDeck = useCallback(
    (which: Deck, ms: number) => {
      const el = deckEl(which);
      if (!el || el.readyState < 1) {
        pendingSeek.current[which] = ms;
        return;
      }
      try {
        el.currentTime = ms / 1000;
      } catch {
        pendingSeek.current[which] = ms;
      }
    },
    [deckEl],
  );

  const advance = useCallback(() => {
    setActiveIdx((current) => {
      const last = (pending.current?.slots.length ?? 0) - 1;
      if (current >= last) {
        setPlaying(false);
        return current;
      }
      setSeekTick((tick) => tick + 1);
      return current + 1;
    });
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((current) => !current);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* nothing to do about a blocked store */
      }
      return next;
    });
  }, []);

  /**
   * Arm the stage for the active slot.
   *
   * The src only changes when the clip id does, so two slots cut from one clip
   * are a seek rather than a reload, and the clip after this one is loaded into
   * the hidden deck while this one plays.
   */
  useEffect(() => {
    if (!slot) return;
    const other: Deck = deck === 0 ? 1 : 0;
    const blocked = slot.missing || noPlay.includes(slot.video_id);

    if (!blocked && srcIds[deck] !== slot.video_id) {
      if (srcIds[other] === slot.video_id) {
        setDeck(other);
        return;
      }
      setSrcIds((current) => {
        const next: [string | null, string | null] = [...current];
        next[deck] = slot.video_id;
        return next;
      });
      setVideoRatio(null);
      return;
    }

    const key = `${seekTick}:${activeIdx}:${slot.video_id}:${slot.in_ms}`;
    if (armed.current !== key) {
      armed.current = key;
      setCurrentMs(slot.in_ms);
      stalledSince.current = null;
      if (!blocked) seekDeck(deck, slot.in_ms);
    }

    const next = slots[activeIdx + 1];
    if (
      !blocked &&
      next &&
      !next.missing &&
      !noPlay.includes(next.video_id) &&
      next.video_id !== slot.video_id &&
      srcIds[other] !== next.video_id
    ) {
      setSrcIds((current) => {
        const updated: [string | null, string | null] = [...current];
        updated[other] = next.video_id;
        return updated;
      });
    }
  }, [slot, slots, activeIdx, deck, srcIds, seekTick, noPlay, seekDeck]);

  /** One deck is audible and running at a time. */
  useEffect(() => {
    const other: Deck = deck === 0 ? 1 : 0;
    deckEl(other)?.pause();
    const el = deckEl(deck);
    if (!el) return;
    if (playing && !still) void el.play().catch(() => {});
    if (!playing) el.pause();
  }, [playing, deck, still, activeIdx, seekTick, deckEl]);

  /**
   * The boundary check runs every frame, not on timeupdate: timeupdate fires
   * about four times a second, which is a quarter second of the next shot
   * leaking in at every cut.
   */
  useEffect(() => {
    if (!playing || still) return;
    let raf = 0;
    let shown = -1;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = deckEl(deck);
      const current = pending.current?.slots[activeIdx];
      if (!el || !current) return;

      const ms = el.currentTime * 1000;
      if (Math.abs(ms - shown) > 60) {
        shown = ms;
        setCurrentMs(Math.round(ms));
      }

      // A clip with no local copy can hang instead of failing outright.
      const mark = stalledSince.current;
      if (!mark || Math.abs(mark.ms - ms) > 30) {
        stalledSince.current = { ms, at: Date.now() };
      } else if (!el.paused && Date.now() - mark.at > STALL_MS) {
        stalledSince.current = null;
        setNoPlay((list) =>
          list.includes(current.video_id) ? list : [...list, current.video_id],
        );
        if (!warnedNoPlay.current) {
          warnedNoPlay.current = true;
          toast(
            "That clip will not stream here, so the reel plays it as a still for its hold. The order and the timings are unaffected.",
            "info",
          );
        }
        return;
      }

      if (ms >= current.out_ms - 15) advance();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, still, deck, activeIdx, advance, deckEl, toast]);

  /** Stills hold for as long as the slot does, then flip. */
  useEffect(() => {
    if (!playing || !still || !slot) return;
    const timer = setTimeout(() => advance(), Math.max(600, slot.hold_ms));
    return () => clearTimeout(timer);
  }, [playing, still, slot, activeIdx, seekTick, advance]);

  function onLoadedMetadata(which: Deck) {
    const el = deckEl(which);
    if (!el) return;
    const wanted = pendingSeek.current[which];
    if (wanted !== null) {
      pendingSeek.current[which] = null;
      try {
        el.currentTime = wanted / 1000;
      } catch {
        /* the arm effect will try again on the next change */
      }
    }
    if (which === deck && el.videoWidth > 0 && el.videoHeight > 0) {
      setVideoRatio(el.videoWidth / el.videoHeight);
    }
  }

  function onDeckError(which: Deck) {
    const id = srcIds[which];
    if (!id) return;
    setNoPlay((list) => (list.includes(id) ? list : [...list, id]));
    if (warnedNoPlay.current) return;
    warnedNoPlay.current = true;
    toast(
      "That clip will not stream here, so the reel plays it as a still for its hold. The order and the timings are unaffected.",
      "info",
    );
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInto(event.target)) return;
      if (!reel || reel.slots.length === 0) return;

      const key = event.key;
      const lower = key.toLowerCase();

      // i, o and g belong to the cue overlay, and ? to the help sheet.
      switch (lower) {
        case "[":
          event.preventDefault();
          move(activeIdx, -1);
          break;
        case "]":
          event.preventDefault();
          move(activeIdx, 1);
          break;
        case "d":
          event.preventDefault();
          duplicate(activeIdx);
          break;
        case "backspace":
        case "delete":
          event.preventDefault();
          remove(activeIdx);
          break;
        case "enter":
          if (isControl(event.target)) return;
          event.preventDefault();
          setOpenIdx((current) => (current === activeIdx ? null : activeIdx));
          break;
        case "escape":
          if (openIdx === null) return;
          event.preventDefault();
          setOpenIdx(null);
          break;
        case "arrowup":
          event.preventDefault();
          if (activeIdx > 0) {
            setActive(activeIdx - 1);
            controls.current.get(`${activeIdx - 1}:card`)?.focus();
          }
          break;
        case "arrowdown":
          event.preventDefault();
          if (activeIdx < reel.slots.length - 1) {
            setActive(activeIdx + 1);
            controls.current.get(`${activeIdx + 1}:card`)?.focus();
          }
          break;
        case " ":
        case "k":
          if (isControl(event.target)) return;
          event.preventDefault();
          togglePlay();
          break;
        case "m":
          event.preventDefault();
          toggleMute();
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    reel,
    activeIdx,
    openIdx,
    move,
    duplicate,
    remove,
    setActive,
    togglePlay,
    toggleMute,
  ]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const analysisFor = useCallback(
    (videoId: string): AnalysisPayload | null => {
      const local = state.analyses.find((row) => row.video_id === videoId)?.payload;
      return local ?? fetchedAnalysis[videoId] ?? null;
    },
    [state.analyses, fetchedAnalysis],
  );

  // The inspector is the only thing that needs the filmstrip, so the fetch
  // waits until it is open and only runs when the page did not already have it.
  useEffect(() => {
    if (openIdx === null) return;
    const target = slots[openIdx];
    if (!target || target.missing) return;
    if (analysisFor(target.video_id)) return;
    if (target.video_id in fetchedAnalysis) return;

    let alive = true;
    (async () => {
      try {
        const res = await api<{ analysis: { payload: AnalysisPayload | null } | null }>(
          `/api/videos/${target.video_id}/analysis`,
        );
        if (alive)
          setFetchedAnalysis((current) => ({
            ...current,
            [target.video_id]: res.analysis?.payload ?? null,
          }));
      } catch {
        if (alive)
          setFetchedAnalysis((current) => ({ ...current, [target.video_id]: null }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [openIdx, slots, analysisFor, fetchedAnalysis]);

  const cueLabels = useMemo<Label[]>(() => {
    if (!slot) return [];
    return state.labels.filter((label) => {
      if (label.video_id !== slot.video_id) return false;
      const span = spanOf(label);
      return span.start_ms < slot.out_ms && span.end_ms > slot.in_ms;
    });
  }, [state.labels, slot]);

  const stageRatio = useMemo(() => {
    if (videoRatio) return videoRatio;
    const payload = slot ? analysisFor(slot.video_id) : null;
    if (payload && payload.width > 0 && payload.height > 0) {
      return payload.width / payload.height;
    }
    return 16 / 9;
  }, [videoRatio, slot, analysisFor]);

  const playheadMs = slot
    ? slot.reel_start_ms + Math.max(0, Math.min(slot.hold_ms, currentMs - slot.in_ms))
    : 0;

  // ── Shell ─────────────────────────────────────────────────────────────────

  const header = (
    <header className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-white/[0.06]">
      <Link
        href={`/app/projects/${projectId}`}
        className="flex items-center gap-1.5 text-[13px] text-mute hover:text-chalk transition-colors shrink-0"
      >
        <ChevronLeft size={15} />
        <span className="hidden sm:inline truncate max-w-[22ch]">
          {state.project.name}
        </span>
      </Link>

      <span className="w-px h-4 bg-white/10 shrink-0" />
      <span className="text-[13.5px] text-chalk shrink-0">Reel</span>

      <span
        aria-live="polite"
        className="text-[11px] text-faint truncate min-w-0 hidden sm:block"
      >
        {saving ? "Saving" : savedOnce ? "Saved" : ""}
      </span>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        <span className="hidden xl:flex items-center gap-2 text-[10.5px] text-faint">
          {[
            ["[ ]", "move"],
            ["D", "copy"],
            ["⌫", "remove"],
            ["Enter", "trim"],
            ["Space", "play"],
          ].map(([key, what]) => (
            <span key={key} className="flex items-center gap-1">
              <kbd className="rounded border border-white/12 px-1 py-px">{key}</kbd>
              {what}
            </span>
          ))}
        </span>
        <Button
          variant="primary"
          icon={<Send size={14} />}
          disabled={!reel || reel.slots.length === 0}
          onClick={() => setPacketOpen(true)}
        >
          Send to editor
        </Button>
      </div>
    </header>
  );

  function frame(children: ReactNode) {
    return (
      <div className="lg:h-[calc(100dvh-3rem)] flex flex-col">
        {header}
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-3 sm:px-5 py-4">{children}</div>
        </main>
      </div>
    );
  }

  if (loading) {
    return frame(
      <p className="flex items-center gap-2 py-16 justify-center text-[12.5px] text-mute">
        <Spinner /> Opening the reel
      </p>,
    );
  }

  if (!reel) {
    return frame(
      <Empty
        icon={<TriangleAlert size={18} />}
        title="The reel could not be opened"
        hint={loadError ?? "Something went wrong reading this project's reel."}
        action={
          <Button onClick={() => window.location.reload()}>Try again</Button>
        }
      />,
    );
  }

  if (reel.slots.length === 0) {
    return frame(
      footage.length === 0 ? (
        <Empty
          art={<FilmstripArt />}
          title="No footage to order yet"
          hint="Add the clips for this reel first, then come back and put them in order."
          action={
            <Link href={`/app/projects/${projectId}`}>
              <Button variant="primary" icon={<Film size={14} />}>
                Add footage
              </Button>
            </Link>
          }
        />
      ) : (
        <Empty
          art={<FilmstripArt />}
          title="Your reel starts as everything you shot, in order."
          hint="From there you only take things out and move them around."
          action={
            <Button
              variant="primary"
              icon={<Film size={14} />}
              loading={seeding}
              onClick={seed}
            >
              Start from footage
            </Button>
          }
        />
      ),
    );
  }

  const [targetLow, targetHigh] = reel.target_ms;
  const long = reel.total_ms > targetHigh;
  const short = reel.total_ms < targetLow;
  const runtimeColor = long
    ? "var(--color-warn)"
    : short
      ? "var(--color-mute)"
      : "var(--color-signal)";
  const verdict = long
    ? "longer than the target for this kind of reel"
    : short
      ? "shorter than the target for this kind of reel"
      : "in range for this kind of reel";

  return frame(
    <div className="space-y-3">
      {/* Stage */}
      <div
        className="relative mx-auto rounded-[13px] overflow-hidden bg-black border border-white/[0.07]"
        style={{
          aspectRatio: stageRatio,
          height: "min(calc(100dvh - 430px), 56vh)",
          width: "auto",
          maxWidth: "100%",
        }}
      >
        {([0, 1] as Deck[]).map((which) => (
          <video
            key={which}
            ref={which === 0 ? deckA : deckB}
            src={srcIds[which] ? `/api/videos/${srcIds[which]}/stream` : undefined}
            muted={which === deck ? muted : true}
            className={clsx(
              "absolute inset-0 block h-full w-full object-contain bg-black transition-opacity duration-100",
              which === deck ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
            aria-hidden={which !== deck}
            playsInline
            preload="auto"
            onLoadedMetadata={() => onLoadedMetadata(which)}
            onError={() => onDeckError(which)}
            onEnded={() => {
              if (which === deck && playing) advance();
            }}
            onClick={which === deck ? togglePlay : undefined}
          />
        ))}

        {/* A slot we cannot stream still shows its own frame, at its own length. */}
        {still && slot ? (
          <div className="absolute inset-0 bg-ink-950">
            {slot.frame_idx !== null && !slot.missing ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/videos/${slot.video_id}/frames/${slot.frame_idx}`}
                alt={`Still from ${slot.title ?? slot.source_name}`}
                className="h-full w-full object-contain"
              />
            ) : null}
            <p className="absolute inset-x-3 bottom-3 glass-deep rounded-[10px] px-2.5 py-2 text-[11.5px] leading-relaxed text-chalk-dim">
              {slot.missing
                ? "This clip is no longer in the project, so there is nothing to play. It still holds its place in the order."
                : "This clip will not stream here, so it holds as a still for its length. Your editor works from the original."}
            </p>
          </div>
        ) : null}

        <CueLayer labels={cueLabels} currentMs={currentMs} />
      </div>

      {/* The whole reel, once */}
      <ReelRibbon
        slots={reel.slots}
        activeIdx={activeIdx}
        playheadMs={playheadMs}
        onPick={jumpTo}
      />

      {/* Transport */}
      <div className="glass rounded-[13px] px-3 py-2.5 flex items-center gap-2">
        <button
          onClick={() => jumpTo(Math.max(0, activeIdx - 1))}
          disabled={activeIdx === 0}
          title="Previous slot"
          aria-label="Previous slot"
          className="size-9 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <SkipBack size={15} />
        </button>
        <button
          onClick={togglePlay}
          title="Play the reel (Space)"
          aria-label={playing ? "Pause (Space)" : "Play the reel (Space)"}
          className="size-10 grid place-items-center rounded-full bg-white/[0.09] text-chalk hover:bg-white/[0.14] transition-colors"
        >
          {playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" className="ml-0.5" />
          )}
        </button>
        <button
          onClick={() => jumpTo(Math.min(reel.slots.length - 1, activeIdx + 1))}
          disabled={activeIdx >= reel.slots.length - 1}
          title="Next slot"
          aria-label="Next slot"
          className="size-9 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <SkipForward size={15} />
        </button>

        <p className="min-w-0 flex-1 truncate text-[12.5px] text-chalk-dim ml-1">
          {slot ? (slot.title ?? slot.source_name) : ""}
        </p>

        <button
          onClick={toggleMute}
          title="Sound (M)"
          aria-label={muted ? "Turn sound on (M)" : "Mute (M)"}
          aria-pressed={muted}
          className="size-9 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors shrink-0"
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      </div>

      {/* The one number */}
      <div className="flex items-center gap-4 px-1 pt-1">
        <div className="shrink-0">
          <p className="text-eyebrow">Runtime</p>
          <p className="text-display text-[30px] tabular leading-none mt-1 text-chalk">
            {timecode(reel.total_ms)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <Meter
            value={targetHigh > 0 ? (reel.total_ms / targetHigh) * 100 : 0}
            color={runtimeColor}
          />
          <p className="text-[11.5px] text-mute mt-2 leading-relaxed">{verdict}</p>
        </div>
      </div>

      {/* Slot strip */}
      <ol className="space-y-2 pb-6" aria-label="Slots, in the order they play">
        {reel.slots.map((entry, idx) => (
          <SlotCard
            key={idx}
            slot={entry}
            idx={idx}
            count={reel.slots.length}
            active={idx === activeIdx}
            open={openIdx === idx}
            payload={entry.missing ? null : analysisFor(entry.video_id)}
            analysisPending={
              !entry.missing &&
              !analysisFor(entry.video_id) &&
              !(entry.video_id in fetchedAnalysis)
            }
            registerControl={registerControl}
            onFocusCard={() => setActive(idx)}
            onJump={() => jumpTo(idx)}
            onMove={(delta) => move(idx, delta)}
            onDuplicate={() => duplicate(idx)}
            onRemove={() => remove(idx)}
            onToggleOpen={() => setOpenIdx(openIdx === idx ? null : idx)}
            onTrim={(inMs, outMs, snap) => trim(idx, inMs, outMs, snap)}
          />
        ))}
      </ol>

      <PacketSheet
        open={packetOpen}
        onClose={() => setPacketOpen(false)}
        projectId={projectId}
        reel={reel}
      />
    </div>,
  );
}

// ── One slot ────────────────────────────────────────────────────────────────

function SlotCard({
  slot,
  idx,
  count,
  active,
  open,
  payload,
  analysisPending,
  registerControl,
  onFocusCard,
  onJump,
  onMove,
  onDuplicate,
  onRemove,
  onToggleOpen,
  onTrim,
}: {
  slot: ReelSlotView;
  idx: number;
  count: number;
  active: boolean;
  open: boolean;
  payload: AnalysisPayload | null;
  analysisPending: boolean;
  registerControl: (key: string, el: HTMLElement | null) => void;
  onFocusCard: () => void;
  onJump: () => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onToggleOpen: () => void;
  onTrim: (inMs: number, outMs: number, snap: ReelSlotView["snap"]) => void;
}) {
  const name = slot.title ?? slot.source_name;
  const poster =
    slot.frame_idx !== null && !slot.missing
      ? `/api/videos/${slot.video_id}/frames/${slot.frame_idx}`
      : null;

  return (
    <li>
      <div
        ref={(el) => {
          registerControl(`${idx}:card`, el);
        }}
        tabIndex={0}
        onFocus={onFocusCard}
        aria-label={`Slot ${idx + 1} of ${count}, ${name}`}
        className={clsx(
          "rounded-[12px] border transition-colors",
          slot.missing
            ? "border-danger/45 bg-danger/[0.06]"
            : active
              ? "border-signal/45 bg-white/[0.05]"
              : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
        )}
      >
        <div className="flex items-start gap-3 p-2.5">
          <button
            onClick={onJump}
            aria-label={`Play from slot ${idx + 1}`}
            className="relative shrink-0 size-[58px] rounded-[9px] overflow-hidden bg-ink-900 border border-white/[0.07] hover:border-white/25 transition-colors"
          >
            {poster ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={poster}
                alt=""
                aria-hidden
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="grid h-full w-full place-items-center text-faint">
                {slot.missing ? <TriangleAlert size={15} /> : <Film size={15} />}
              </span>
            )}
            <span className="absolute left-1 top-1 rounded bg-ink-950/75 px-1 text-[10px] tabular text-chalk-dim">
              {idx + 1}
            </span>
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-chalk truncate">{name}</p>
            <p className="text-[11px] text-faint truncate">{slot.source_name}</p>
            {slot.missing ? (
              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-danger leading-relaxed">
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                This clip is no longer in the project. Remove the slot, or put the
                clip back on the Footage tab.
              </p>
            ) : null}
            {slot.note ? (
              <p className="mt-1 text-[11.5px] text-mute leading-relaxed clamp-2">
                {slot.note}
              </p>
            ) : null}
          </div>

          <span className="shrink-0 tabular text-[12px] text-chalk-dim mt-0.5">
            {(slot.hold_ms / 1000).toFixed(1)}s
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2.5">
          <button
            ref={(el) => {
              registerControl(`${idx}:up`, el);
            }}
            onClick={() => onMove(-1)}
            disabled={idx === 0}
            title="Move up ([)"
            aria-label={`Move slot ${idx + 1} up, bracket left`}
            className="size-9 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors disabled:opacity-35 disabled:pointer-events-none"
          >
            <ArrowUp size={15} />
          </button>
          <button
            ref={(el) => {
              registerControl(`${idx}:down`, el);
            }}
            onClick={() => onMove(1)}
            disabled={idx >= count - 1}
            title="Move down (])"
            aria-label={`Move slot ${idx + 1} down, bracket right`}
            className="size-9 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors disabled:opacity-35 disabled:pointer-events-none"
          >
            <ArrowDown size={15} />
          </button>
          <button
            ref={(el) => {
              registerControl(`${idx}:duplicate`, el);
            }}
            onClick={onDuplicate}
            title="Use this clip again (D)"
            aria-label={`Use slot ${idx + 1} again, D`}
            className="size-9 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors"
          >
            <Copy size={14} />
          </button>
          <button
            ref={(el) => {
              registerControl(`${idx}:remove`, el);
            }}
            onClick={onRemove}
            title="Remove from the reel (Backspace)"
            aria-label={`Remove slot ${idx + 1} from the reel, Backspace`}
            className="size-9 grid place-items-center rounded-lg text-mute hover:text-danger hover:bg-danger/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>

          {slot.missing ? null : (
            <button
              onClick={onToggleOpen}
              aria-expanded={open}
              title="Trim (Enter)"
              className="ml-auto flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors"
            >
              <Scissors size={13} />
              {open ? "Close" : "Trim"}
            </button>
          )}
        </div>

        {open && !slot.missing ? (
          <TrimInspector
            slot={slot}
            payload={payload}
            pendingAnalysis={analysisPending}
            onTrim={onTrim}
            onClose={onToggleOpen}
          />
        ) : null}
      </div>
    </li>
  );
}

// ── Trim ────────────────────────────────────────────────────────────────────

function TrimInspector({
  slot,
  payload,
  pendingAnalysis,
  onTrim,
  onClose,
}: {
  slot: ReelSlotView;
  payload: AnalysisPayload | null;
  pendingAnalysis: boolean;
  onTrim: (inMs: number, outMs: number, snap: ReelSlotView["snap"]) => void;
  onClose: () => void;
}) {
  const [aim, setAim] = useState<"in" | "out">("in");

  const duration = Math.max(
    slot.duration_ms || 0,
    payload?.duration_ms ?? 0,
    slot.out_ms,
  );

  /** Every cut the analyser found inside this clip, ends included. */
  const cuts = useMemo(() => {
    const found = new Set<number>();
    for (const shot of payload?.shots ?? []) {
      found.add(Math.round(shot.start_ms));
      found.add(Math.round(shot.end_ms));
    }
    return [...found]
      .filter((ms) => ms > 80 && ms < duration - 80)
      .sort((a, b) => a - b);
  }, [payload, duration]);

  const targets = useMemo(
    () => [0, ...cuts, duration].sort((a, b) => a - b),
    [cuts, duration],
  );

  const frames = payload?.frames ?? [];

  function snap(ms: number): { ms: number; onCut: boolean } {
    let best = ms;
    let distance = Number.POSITIVE_INFINITY;
    for (const target of targets) {
      const gap = Math.abs(target - ms);
      if (gap < distance) {
        distance = gap;
        best = target;
      }
    }
    if (distance > SNAP_MS) return { ms: Math.round(ms), onCut: false };
    return { ms: best, onCut: cuts.includes(best) };
  }

  function snapFor(inMs: number): ReelSlotView["snap"] {
    return cuts.some((cut) => Math.abs(cut - inMs) <= 1) ? "shot" : "manual";
  }

  function setIn(raw: number) {
    const picked = snap(raw);
    const inMs = Math.max(0, Math.min(picked.ms, duration - MIN_SLOT_MS));
    const outMs = Math.min(duration, Math.max(slot.out_ms, inMs + MIN_SLOT_MS));
    onTrim(inMs, outMs, snapFor(inMs));
  }

  function setOut(raw: number) {
    const picked = snap(raw);
    const outMs = Math.min(
      duration,
      Math.max(picked.ms, Math.min(slot.in_ms + MIN_SLOT_MS, duration)),
    );
    onTrim(slot.in_ms, outMs, snapFor(slot.in_ms));
  }

  const pct = (ms: number) =>
    duration > 0 ? Math.max(0, Math.min(100, (ms / duration) * 100)) : 0;

  const where =
    slot.in_ms <= 1
      ? "starting where the clip starts"
      : cuts.some((cut) => Math.abs(cut - slot.in_ms) <= 1)
        ? "in point on a detected cut"
        : "in point set by hand";

  const line = `${(slot.hold_ms / 1000).toFixed(1)}s of ${(duration / 1000).toFixed(1)}s, ${where}, accurate to about ${(TRIM_ACCURACY_MS / 1000).toFixed(1)}s. Your editor fine-tunes the frame.`;

  return (
    <div className="border-t border-white/[0.07] px-2.5 py-3 space-y-3 animate-fade">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<"in" | "out">
          value={aim}
          onChange={setAim}
          options={[
            { value: "in", label: "Tap sets in" },
            { value: "out", label: "Tap sets out" },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="quiet" onClick={() => onTrim(0, duration, "manual")}>
            Whole clip
          </Button>
          <Button size="sm" variant="quiet" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>

      {frames.length > 0 ? (
        <div
          className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1"
          role="group"
          aria-label="Frames from this clip"
        >
          {frames.map((entry) => {
            const inside = entry.at_ms >= slot.in_ms && entry.at_ms < slot.out_ms;
            return (
              <button
                key={entry.idx}
                onClick={(event) => {
                  // Shift is the desktop shortcut for the out point; the
                  // segmented control above is how a phone does the same.
                  if (event.shiftKey || aim === "out") setOut(entry.at_ms);
                  else setIn(entry.at_ms);
                }}
                title={`${timecode(entry.at_ms, true)}, tap to set the ${aim === "out" ? "out" : "in"} point`}
                aria-label={`Set the ${aim === "out" ? "out" : "in"} point at ${timecode(entry.at_ms)}`}
                aria-pressed={inside}
                className={clsx(
                  "shrink-0 overflow-hidden rounded-[7px] border transition-all",
                  inside
                    ? "border-signal/70 opacity-100"
                    : "border-white/[0.09] opacity-45 hover:opacity-80",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/videos/${slot.video_id}/frames/${entry.idx}`}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-14 w-auto"
                />
              </button>
            );
          })}
        </div>
      ) : pendingAnalysis ? (
        <p className="flex items-center gap-2 text-[12px] text-mute">
          <Spinner /> Looking for this clip's frames
        </p>
      ) : (
        <p className="text-[12px] text-mute leading-relaxed">
          No frames for this clip yet. Analyse it on the project's Plan tab and the
          cuts show up here. The handles below still work.
        </p>
      )}

      {/* Where the cuts are, on the same axis as the handles below it. */}
      <div aria-hidden className="relative h-[10px] rounded-[3px] bg-white/[0.05]">
        <span
          className="absolute inset-y-0 rounded-[3px] bg-signal/25"
          style={{ left: `${pct(slot.in_ms)}%`, right: `${100 - pct(slot.out_ms)}%` }}
        />
        {cuts.map((cut) => (
          <span
            key={cut}
            className="absolute inset-y-0 w-px bg-white/35"
            style={{ left: `${pct(cut)}%` }}
          />
        ))}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2.5">
          <span className="w-7 text-[11px] text-faint">In</span>
          <input
            type="range"
            className="scrub flex-1 min-w-0"
            min={0}
            max={Math.max(1, duration)}
            step={50}
            value={Math.min(slot.in_ms, duration)}
            onChange={(event) => setIn(Number(event.target.value))}
            aria-label="In point"
            aria-valuetext={timecode(slot.in_ms, true)}
          />
        </label>
        <label className="flex items-center gap-2.5">
          <span className="w-7 text-[11px] text-faint">Out</span>
          <input
            type="range"
            className="scrub flex-1 min-w-0"
            min={0}
            max={Math.max(1, duration)}
            step={50}
            value={Math.min(slot.out_ms, duration)}
            onChange={(event) => setOut(Number(event.target.value))}
            aria-label="Out point"
            aria-valuetext={timecode(slot.out_ms, true)}
          />
        </label>
      </div>

      <p className="text-[11.5px] text-mute leading-relaxed">{line}</p>
    </div>
  );
}
