"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ChevronLeft,
  Gauge,
  ListChecks,
  Maximize2,
  MessagesSquare,
  Mic,
  Pause,
  Play,
  Rewind,
  FastForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Avatar, Segmented, useToast } from "@/components/ui";
import { timecode } from "@/lib/format";
import type { ProjectDetail } from "@/lib/queries";
import { api, useProject } from "@/components/project/useProject";
import { Room } from "@/components/project/Room";
import { CutList } from "@/components/project/CutList";
import { Timeline } from "./Timeline";
import { Recorder } from "./Recorder";
import { NotesPanel } from "./NotesPanel";

type Panel = "notes" | "cutlist" | "room";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function Walkthrough({
  initial,
  videoId,
}: {
  initial: ProjectDetail;
  videoId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { project: state, presence, live, refresh } = useProject(initial);

  const video = useMemo(
    () => state.videos.find((v) => v.id === videoId) ?? null,
    [state.videos, videoId],
  );

  const player = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(video?.duration_ms ?? 0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [panel, setPanel] = useState<Panel>("notes");
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
  const recordTrigger = useRef<(() => void) | null>(null);
  const registerRecordTrigger = useCallback((toggleRecording: () => void) => {
    recordTrigger.current = toggleRecording;
  }, []);

  const labels = useMemo(
    () => state.labels.filter((l) => l.video_id === videoId),
    [state.labels, videoId],
  );
  const notes = useMemo(
    () => state.notes.filter((n) => n.video_id === videoId),
    [state.notes, videoId],
  );
  const openCount = labels.filter((l) => ["open", "doing"].includes(l.status)).length;
  const labelTitles = useMemo(
    () => new Map(state.labels.map((l) => [l.id, l.title])),
    [state.labels],
  );

  const seek = useCallback((ms: number) => {
    const el = player.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
    setCurrentMs(Math.max(0, ms));
  }, []);

  const toggle = useCallback(() => {
    const el = player.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  // ── Keyboard: the walkthrough is meant to be driven without the mouse ─────
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const el = player.current;
      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          toggle();
          break;
        case "j":
          event.preventDefault();
          seek(currentMs - 10_000);
          break;
        case "l":
          event.preventDefault();
          seek(currentMs + 10_000);
          break;
        case "arrowleft":
          event.preventDefault();
          seek(currentMs - 5000);
          break;
        case "arrowright":
          event.preventDefault();
          seek(currentMs + 5000);
          break;
        case ",":
          event.preventDefault();
          seek(currentMs - 1000 / 30);
          break;
        case ".":
          event.preventDefault();
          seek(currentMs + 1000 / 30);
          break;
        case "m":
          if (el) {
            el.muted = !el.muted;
            setMuted(el.muted);
          }
          break;
        case "r":
          event.preventDefault();
          recordTrigger.current?.();
          break;
        case "f":
          event.preventDefault();
          void shell.current?.requestFullscreen?.().catch(() => {});
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentMs, seek, toggle]);

  // The browser is the only thing that actually knows the duration of an
  // uploaded file, so the first play backfills it for everyone else.
  async function onLoadedMetadata() {
    const el = player.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const ms = Math.round(el.duration * 1000);
    setDurationMs(ms);
    if (video && Math.abs(video.duration_ms - ms) > 1000) {
      try {
        await api(`/api/videos/${video.id}`, {
          method: "PATCH",
          json: { durationMs: ms },
        });
      } catch {
        /* cosmetic — the timeline already has the right value locally */
      }
    }
  }

  if (!video) {
    return (
      <div className="min-h-dvh grid place-items-center p-8 text-center">
        <div>
          <p className="text-display text-[22px]">That clip is gone</p>
          <p className="text-[13px] text-mute mt-2">
            It may have been removed from the project.
          </p>
          <Link
            href={`/app/projects/${state.project.id}`}
            className="mt-5 inline-flex h-10 px-4 items-center rounded-[10px] border border-white/15 text-[13.5px] text-chalk-dim hover:text-chalk"
          >
            Back to the project
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="lg:h-dvh flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-white/[0.06]">
        <Link
          href={`/app/projects/${state.project.id}`}
          className="flex items-center gap-1.5 text-[13px] text-mute hover:text-chalk transition-colors shrink-0"
        >
          <ChevronLeft size={15} />
          <span className="hidden sm:inline truncate max-w-[22ch]">
            {state.project.name}
          </span>
        </Link>

        <span className="w-px h-4 bg-white/10 shrink-0" />

        <span className="text-[13.5px] text-chalk truncate min-w-0">
          {video.title}
        </span>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="hidden xl:flex items-center gap-2 text-[10.5px] text-faint">
            {[
              ["Space", "play"],
              ["J / L", "±10s"],
              [", .", "frame"],
              ["R", "record"],
            ].map(([key, what]) => (
              <span key={key} className="flex items-center gap-1">
                <kbd className="rounded border border-white/12 px-1 py-px">{key}</kbd>
                {what}
              </span>
            ))}
          </span>
          {presence.length > 0 ? (
            <div className="flex -space-x-1.5">
              {presence.slice(0, 4).map((person) => (
                <Avatar
                  key={person.id}
                  name={person.name}
                  seed={person.id}
                  size={22}
                  className="ring-2 ring-ink-950"
                />
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex-1 min-h-0 grid lg:grid-cols-[176px_minmax(0,1fr)_348px]">
        {/* Clip rail */}
        <nav className="hidden lg:flex flex-col border-r border-white/[0.06] min-h-0">
          <span className="text-eyebrow px-4 pt-4 pb-2">Clips</span>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
            {state.videos.map((clip) => {
              const clipLabels = state.labels.filter(
                (l) => l.video_id === clip.id && ["open", "doing"].includes(l.status),
              ).length;
              return (
                <Link
                  key={clip.id}
                  href={`/app/projects/${state.project.id}/walkthrough/${clip.id}`}
                  className={clsx(
                    "block rounded-[10px] px-2.5 py-2 transition-colors",
                    clip.id === videoId
                      ? "bg-white/[0.08] text-chalk"
                      : "text-mute hover:text-chalk-dim hover:bg-white/[0.04]",
                  )}
                >
                  <span className="block text-[12.5px] truncate">{clip.title}</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-faint mt-0.5">
                    <span className="tabular">
                      {clip.duration_ms ? timecode(clip.duration_ms) : "—"}
                    </span>
                    {clipLabels > 0 ? (
                      <>
                        <span className="size-[3px] rounded-full bg-faint/60" />
                        <span className="tabular">{clipLabels}</span>
                      </>
                    ) : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Stage */}
        <main
          ref={shell}
          className="min-w-0 flex flex-col gap-3 p-4 overflow-y-auto bg-ink-950/30"
        >
          <div className="relative rounded-[13px] overflow-hidden bg-black border border-white/[0.07] shrink-0">
            <video
              ref={player}
              src={`/api/videos/${video.id}/stream`}
              className="w-full max-h-[calc(100dvh-330px)] aspect-video object-contain bg-black"
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={(e) =>
                setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))
              }
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={toggle}
              onError={() =>
                toast(
                  "This clip could not be played. If it came from a link, the source may block embedding.",
                  "error",
                )
              }
              playsInline
              preload="metadata"
            />
          </div>

          {/* Transport */}
          <div className="glass rounded-[13px] px-3 py-2.5 flex items-center gap-2 shrink-0">
            <button
              onClick={() => seek(currentMs - 10_000)}
              className="size-8 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors"
              title="Back 10s (J)"
            >
              <Rewind size={15} />
            </button>
            <button
              onClick={toggle}
              className="size-10 grid place-items-center rounded-full bg-white/[0.09] text-chalk hover:bg-white/[0.14] transition-colors"
              title="Play / pause (Space)"
            >
              {playing ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button
              onClick={() => seek(currentMs + 10_000)}
              className="size-8 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors"
              title="Forward 10s (L)"
            >
              <FastForward size={15} />
            </button>

            <span className="tabular text-[12px] text-chalk-dim ml-1.5 shrink-0">
              {timecode(currentMs, true)}
              <span className="text-faint">
                {" / "}
                {timecode(durationMs)}
              </span>
            </span>

            <input
              type="range"
              className="scrub flex-1 mx-2 min-w-[60px]"
              min={0}
              max={Math.max(1, durationMs)}
              value={Math.min(currentMs, durationMs)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
            />

            <div className="flex items-center gap-1 shrink-0">
              <Gauge size={13} className="text-faint" />
              <select
                value={speed}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSpeed(next);
                  if (player.current) player.current.playbackRate = next;
                }}
                className="bg-transparent text-[11.5px] tabular text-mute hover:text-chalk cursor-pointer appearance-none outline-none"
              >
                {SPEEDS.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => {
                const el = player.current;
                if (!el) return;
                el.muted = !el.muted;
                setMuted(el.muted);
              }}
              className="size-8 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors shrink-0"
              title="Mute (M)"
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <button
              onClick={() => void shell.current?.requestFullscreen?.().catch(() => {})}
              className="size-8 grid place-items-center rounded-lg text-mute hover:text-chalk hover:bg-white/[0.07] transition-colors shrink-0"
              title="Fullscreen (F)"
            >
              <Maximize2 size={14} />
            </button>
          </div>

          <div className="shrink-0">
            <Timeline
              durationMs={durationMs}
              currentMs={currentMs}
              labels={labels}
              noteAnchors={notes.map((n) => ({ id: n.id, at: n.anchor_ms }))}
              onSeek={seek}
              onPickLabel={(label) => {
                setActiveLabelId(label.id);
                setPanel("cutlist");
              }}
              activeLabelId={activeLabelId}
            />
          </div>

          {state.capabilities.canNote ? (
            <div className="shrink-0">
              <Recorder
                projectId={state.project.id}
                videoId={video.id}
                getAnchorMs={() => currentMs}
                sttLabel={state.ai.stt}
                registerTrigger={registerRecordTrigger}
                onBeforeRecord={() => player.current?.pause()}
                onDone={({ labels: count, warning }) => {
                  refresh();
                  if (warning) toast(warning, "error");
                  else
                    toast(
                      count
                        ? `${count} instruction${count === 1 ? "" : "s"} added to the cut list`
                        : "Note saved — nothing actionable was detected in it",
                      count ? "ok" : "info",
                    );
                }}
              />
            </div>
          ) : null}
        </main>

        {/* Side panel */}
        <aside className="border-t lg:border-t-0 lg:border-l border-white/[0.06] flex flex-col min-h-[440px] lg:min-h-0">
          <div className="px-3 py-2.5 shrink-0">
            <Segmented<Panel>
              value={panel}
              onChange={setPanel}
              className="w-full"
              options={[
                { value: "notes", label: <><Mic size={12} /> Notes</>, count: notes.length },
                {
                  value: "cutlist",
                  label: <><ListChecks size={12} /> Cut list</>,
                  count: openCount,
                },
                { value: "room", label: <><MessagesSquare size={12} /> Room</> },
              ]}
            />
          </div>

          <div className="rule-x shrink-0" />

          {panel === "notes" ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <NotesPanel
                notes={notes}
                labels={state.labels}
                meId={state.me.id}
                canEdit={state.capabilities.canNote}
                onSeek={seek}
                onChanged={refresh}
              />
            </div>
          ) : null}

          {panel === "cutlist" ? (
            <CutList
              projectId={state.project.id}
              labels={state.labels}
              videos={state.videos}
              canEdit={state.capabilities.canLabel}
              canChat={state.capabilities.canChat}
              messages={state.messages}
              meId={state.me.id}
              activeVideoId={videoId}
              compact
              onChanged={() => {
                refresh();
                router.refresh();
              }}
              onSeek={(clipId, ms) => {
                if (clipId && clipId !== videoId) {
                  router.push(`/app/projects/${state.project.id}/walkthrough/${clipId}`);
                  return;
                }
                seek(ms);
              }}
            />
          ) : null}

          {panel === "room" ? (
            <Room
              projectId={state.project.id}
              messages={state.messages}
              presence={presence}
              live={live}
              canChat={state.capabilities.canChat}
              meId={state.me.id}
              labelTitles={labelTitles}
              atMs={currentMs}
              videoId={videoId}
              onSeek={seek}
              className="flex-1"
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
