"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  AudioLines,
  Check,
  Clapperboard,
  Copy,
  Gauge,
  ListPlus,
  Scan,
  Sparkles,
  Star,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { Button, Chip, Empty, Meter, Panel, PanelHeader, Spinner, useToast } from "@/components/ui";
import { FilmstripArt } from "@/components/EmptyArt";
import { timecode } from "@/lib/format";
import { labelStyle } from "@/lib/labelStyle";
import { NICHES } from "@/lib/analysis/presets";
import type { AnalysisPayload, NicheId, PlanPayload } from "@/lib/analysis/types";
import type { Video } from "@/lib/types";
import { api } from "./useProject";

/**
 * Footage analysis and the edit plan it produces.
 *
 * Nothing here touches the media. The analysis measures the clip, the plan
 * suggests what to do about it, and an item only becomes an instruction when
 * the creator accepts it into the cut list.
 */

interface AnalysisView {
  id: string;
  video_id: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  engine: string;
  width: number;
  height: number;
  fps: number;
  duration_ms: number;
  has_audio: boolean;
  bpm: number;
  scene_count: number;
  updated_at: number;
  payload: AnalysisPayload | null;
}

interface PlanView {
  id: string;
  video_id: string;
  niche: string;
  origin: "local" | "ai";
  model: string;
  created_at: number;
  payload: PlanPayload | null;
}

interface AnalysisResponse {
  analysis: AnalysisView | null;
  running: boolean;
  frames: { idx: number; at_ms: number }[];
  tags: { tag: string; kind: string }[];
  plan: PlanView | null;
  ffmpeg: boolean;
}

export function PlanPanel({
  projectId,
  videos,
  niche,
  referenceVideoId,
  aiAvailable,
  canRun,
  onChanged,
}: {
  projectId: string;
  videos: Video[];
  niche: NicheId;
  referenceVideoId: string | null;
  aiAvailable: boolean;
  canRun: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const footage = useMemo(() => videos.filter((v) => v.role !== "reference"), [videos]);
  const references = useMemo(() => videos.filter((v) => v.role === "reference"), [videos]);

  const [videoId, setVideoId] = useState<string>(footage[0]?.id ?? videos[0]?.id ?? "");
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [useAi, setUseAi] = useState(true);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const video = videos.find((v) => v.id === videoId) ?? null;

  const load = useCallback(async () => {
    if (!videoId) return;
    try {
      const res = await api<AnalysisResponse>(`/api/videos/${videoId}/analysis`);
      setData(res);
      setPicked(new Set());
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [videoId, toast]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // While a pass is running the row is the only source of truth, so poll it.
  useEffect(() => {
    const busy = data?.running || data?.analysis?.status === "running";
    if (!busy) {
      if (poll.current) clearInterval(poll.current);
      poll.current = null;
      return;
    }
    poll.current = setInterval(() => void load(), 2500);
    return () => {
      if (poll.current) clearInterval(poll.current);
      poll.current = null;
    };
  }, [data?.running, data?.analysis?.status, load]);

  async function analyse() {
    setLoading(true);
    try {
      await api(`/api/videos/${videoId}/analysis`, { method: "POST" });
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setPlanning(true);
    try {
      const res = await api<{ plan: PlanView; warning: string | null }>(
        `/api/videos/${videoId}/plan`,
        { method: "POST", json: { niche, useAi } },
      );
      setData((current) => (current ? { ...current, plan: res.plan } : current));
      setPicked(new Set());
      if (res.warning) toast(res.warning, "info");
      else
        toast(
          res.plan.origin === "ai" ? "Edit plan ready" : "Offline edit plan ready",
          "ok",
        );
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setPlanning(false);
    }
  }

  async function applyPicked() {
    if (picked.size === 0) return;
    setApplying(true);
    try {
      const res = await api<{ added: number }>(`/api/videos/${videoId}/plan/apply`, {
        method: "POST",
        json: { itemIds: [...picked] },
      });
      toast(`${res.added} added to the cut list`, "ok");
      setPicked(new Set());
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setApplying(false);
    }
  }

  async function setNiche(next: NicheId) {
    try {
      await api(`/api/projects/${projectId}`, { method: "PATCH", json: { niche: next } });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function setReference(next: string | null) {
    try {
      await api(`/api/projects/${projectId}`, {
        method: "PATCH",
        json: { referenceVideoId: next },
      });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function markReference(makeReference: boolean) {
    try {
      await api(`/api/videos/${videoId}`, {
        method: "PATCH",
        json: { role: makeReference ? "reference" : "footage" },
      });
      onChanged();
      toast(
        makeReference
          ? "Marked as a reference reel. Analyse it to pull out its rhythm."
          : "Back to footage.",
        "ok",
      );
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  if (videos.length === 0) {
    return (
      <Panel>
        <Empty
          art={<FilmstripArt />}
          title="Nothing to analyse yet"
          hint="Add footage first. The analyser reads the file itself: where the cuts are, how the music moves, where the silence sits."
        />
      </Panel>
    );
  }

  const analysis = data?.analysis ?? null;
  const payload = analysis?.payload ?? null;
  const plan = data?.plan?.payload ?? null;
  const running = Boolean(data?.running || analysis?.status === "running");

  return (
    <div className="space-y-4">
      {data && !data.ffmpeg ? (
        <Panel className="border border-warn/25">
          <div className="px-5 py-4 flex items-start gap-3">
            <TriangleAlert size={16} className="text-warn shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] text-chalk">Footage analysis needs ffmpeg</p>
              <p className="text-[12.5px] text-mute mt-1 leading-relaxed">
                Run <code className="text-chalk-dim">npm install ffmpeg-static ffprobe-static</code>{" "}
                in the project folder and restart the server. If you already have ffmpeg, set
                FFMPEG_PATH and FFPROBE_PATH in .env.local instead.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      {/* Clip and preset */}
      <Panel>
        <div className="px-5 py-4 flex flex-wrap items-end gap-4">
          <label className="min-w-[180px] flex-1">
            <span className="block text-[11px] text-faint mb-1.5">Clip</span>
            <select
              className="field"
              value={videoId}
              onChange={(e) => setVideoId(e.target.value)}
            >
              {videos.map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.role === "reference" ? "Reference: " : ""}
                  {clip.title}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-[180px] flex-1">
            <span className="block text-[11px] text-faint mb-1.5">What are you making</span>
            <select
              className="field"
              value={niche}
              disabled={!canRun}
              onChange={(e) => setNiche(e.target.value as NicheId)}
            >
              {NICHES.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-[180px] flex-1">
            <span className="block text-[11px] text-faint mb-1.5">Reference reel</span>
            <select
              className="field"
              value={referenceVideoId ?? ""}
              disabled={!canRun}
              onChange={(e) => setReference(e.target.value || null)}
            >
              <option value="">None</option>
              {[...references, ...footage].map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="px-5 pb-4 flex flex-wrap items-center gap-2">
          <p className="text-[12px] text-mute flex-1 min-w-[220px] leading-relaxed">
            {NICHES.find((n) => n.id === niche)?.blurb}
          </p>
          {canRun && video ? (
            <Button
              size="sm"
              variant="quiet"
              icon={<Star size={13} />}
              onClick={() => markReference(video.role !== "reference")}
            >
              {video.role === "reference" ? "Use as footage" : "Mark as reference"}
            </Button>
          ) : null}
        </div>
      </Panel>

      {/* Analysis */}
      <Panel>
        <PanelHeader
          eyebrow="Step 1, free and offline"
          title="What is actually in this clip"
          action={
            canRun ? (
              <Button
                size="sm"
                variant={analysis?.status === "done" ? "ghost" : "primary"}
                icon={<Scan size={14} />}
                loading={loading || running}
                onClick={analyse}
              >
                {analysis?.status === "done" ? "Re-analyse" : "Analyse footage"}
              </Button>
            ) : null
          }
        />

        <div className="px-5 pb-5">
          {running ? (
            <p className="text-[12.5px] text-mute flex items-center gap-2">
              <Spinner /> Reading shots, motion, colour, beats and silences. A minute of
              footage takes a few seconds.
            </p>
          ) : analysis?.status === "failed" ? (
            <p className="text-[12.5px] text-danger leading-relaxed">
              {analysis.error ?? "The analysis failed."}
            </p>
          ) : !payload ? (
            <p className="text-[12.5px] text-mute leading-relaxed max-w-[62ch]">
              Nothing has been measured yet. The analyser runs on your machine with no API
              key: it finds every cut, how much each shot moves, its colour, the tempo and
              beat grid of the music, and every silence. The edit plan is built from that.
            </p>
          ) : (
            <Measurements payload={payload} tags={data?.tags ?? []} videoId={videoId} projectId={projectId} frames={data?.frames ?? []} />
          )}
        </div>
      </Panel>

      {/* Plan */}
      <Panel>
        <PanelHeader
          eyebrow={
            plan
              ? `Step 2 · ${data?.plan?.origin === "ai" ? data?.plan?.model : "offline, no key used"}`
              : "Step 2"
          }
          title="Suggested edit plan"
          action={
            canRun && payload ? (
              <div className="flex items-center gap-2">
                {aiAvailable ? (
                  <label className="flex items-center gap-1.5 text-[11.5px] text-mute cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAi}
                      onChange={(e) => setUseAi(e.target.checked)}
                      className="accent-[var(--color-signal)]"
                    />
                    Use AI
                  </label>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Wand2 size={14} />}
                  loading={planning}
                  onClick={generate}
                >
                  {plan ? "Regenerate" : "Generate plan"}
                </Button>
              </div>
            ) : null
          }
        />

        <div className="px-5 pb-5">
          {!payload ? (
            <p className="text-[12.5px] text-faint">Analyse the clip first.</p>
          ) : !plan ? (
            <p className="text-[12.5px] text-mute leading-relaxed max-w-[62ch]">
              The plan turns those measurements into moves: what to open on, what to cut,
              where to land on the beat, what to put on screen.{" "}
              {aiAvailable
                ? "With a key connected it also sends a handful of stills to the model for a second read."
                : "No AI key is connected, so this runs entirely offline. Add a key in Settings for a sharper read."}
            </p>
          ) : (
            <PlanBody
              plan={plan}
              picked={picked}
              setPicked={setPicked}
              canApply={canRun}
              applying={applying}
              onApply={applyPicked}
              projectId={projectId}
              videoId={videoId}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[11px] glass-soft px-3 py-2.5">
      <p className="text-[10.5px] text-faint uppercase tracking-wide">{label}</p>
      <p className="text-[15px] text-chalk tabular mt-0.5">{value}</p>
      {sub ? <p className="text-[10.5px] text-faint mt-0.5">{sub}</p> : null}
    </div>
  );
}

function Measurements({
  payload,
  tags,
  frames,
  videoId,
  projectId,
}: {
  payload: AnalysisPayload;
  tags: { tag: string; kind: string }[];
  frames: { idx: number; at_ms: number }[];
  videoId: string;
  projectId: string;
}) {
  const lengths = payload.shots.map((s) => s.end_ms - s.start_ms).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const talking = payload.speech.reduce((a, r) => a + (r.end_ms - r.start_ms), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        <Stat label="Shots" value={String(payload.shots.length)} sub={`${(median / 1000).toFixed(1)}s median`} />
        <Stat
          label="Tempo"
          value={payload.bpm ? `${Math.round(payload.bpm)} BPM` : "none"}
          sub={payload.beats.length ? `${payload.beats.length} beats` : "no steady beat"}
        />
        <Stat label="Drops" value={String(payload.drops.length)} sub="energy jumps" />
        <Stat
          label="Format"
          value={`${payload.width}x${payload.height}`}
          sub={payload.orientation}
        />
        <Stat
          label="Silence"
          value={`${payload.silences.length}`}
          sub={payload.has_audio ? `${Math.round(talking / 1000)}s of sound` : "no audio"}
        />
        <Stat label="Length" value={`${(payload.duration_ms / 1000).toFixed(1)}s`} sub={`${payload.fps} fps`} />
      </div>

      {payload.warnings.length ? (
        <ul className="space-y-1.5">
          {payload.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-[12px] text-warn leading-relaxed">
              <TriangleAlert size={12} className="shrink-0 mt-0.5" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {frames.length ? (
        <div>
          <p className="text-eyebrow mb-2">Shots</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {frames.map((frame) => (
              <Link
                key={frame.idx}
                href={`/app/projects/${projectId}/walkthrough/${videoId}?t=${frame.at_ms}`}
                className="shrink-0 group"
                title={`Open at ${timecode(frame.at_ms)}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/videos/${videoId}/frames/${frame.idx}`}
                  alt={`Frame at ${timecode(frame.at_ms)}`}
                  loading="lazy"
                  className="h-20 w-auto rounded-[8px] border border-white/[0.08] group-hover:border-signal/50 transition-colors"
                />
                <span className="block text-[10px] tabular text-faint mt-1 text-center">
                  {timecode(frame.at_ms)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {payload.speech_text?.text ? (
        <details className="group">
          <summary className="text-[11.5px] text-faint cursor-pointer hover:text-mute list-none">
            Transcript of the clip ({payload.speech_text.provider})
          </summary>
          <p className="mt-2 text-[12px] text-mute leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
            {payload.speech_text.text}
          </p>
        </details>
      ) : null}

      {tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Chip key={tag.tag} title={tag.kind === "ai" ? "From the AI pass" : "Measured locally"}>
              {tag.tag}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlanBody({
  plan,
  picked,
  setPicked,
  canApply,
  applying,
  onApply,
  projectId,
  videoId,
}: {
  plan: PlanPayload;
  picked: Set<string>;
  setPicked: (next: Set<string>) => void;
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
  projectId: string;
  videoId: string;
}) {
  const toast = useToast();

  function toggle(itemId: string) {
    const next = new Set(picked);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setPicked(next);
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`, "ok");
    } catch {
      toast("Copy failed. Select the text and copy it manually.", "error");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[14px] text-chalk leading-snug">{plan.headline}</p>
        <p className="text-[12.5px] text-mute mt-1.5 leading-relaxed">{plan.read}</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-2">
        <div className="rounded-[11px] glass-soft px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] text-faint uppercase tracking-wide">Hook</p>
            <span className="text-[11px] tabular text-chalk-dim">{plan.hook.score}/100</span>
          </div>
          <Meter
            value={plan.hook.score}
            color={plan.hook.score >= 78 ? "#5fd3b0" : plan.hook.score >= 60 ? "#ffd166" : "#ff6b57"}
            className="my-2"
          />
          <p className="text-[11.5px] text-mute leading-relaxed">{plan.hook.advice}</p>
        </div>

        <div className="rounded-[11px] glass-soft px-3 py-2.5">
          <p className="text-[10.5px] text-faint uppercase tracking-wide flex items-center gap-1.5">
            <Gauge size={11} /> Pacing
          </p>
          <p className="text-[12px] text-chalk-dim mt-1.5 leading-relaxed">
            {plan.rhythm.verdict}
          </p>
          <p className="text-[11px] text-faint mt-1 tabular">
            target {(plan.rhythm.target_ms[0] / 1000).toFixed(1)}s to{" "}
            {(plan.rhythm.target_ms[1] / 1000).toFixed(1)}s
            {plan.rhythm.on_beat_pct > 0 ? ` · ${plan.rhythm.on_beat_pct}% on beat` : ""}
          </p>
        </div>

        <div className="rounded-[11px] glass-soft px-3 py-2.5">
          <p className="text-[10.5px] text-faint uppercase tracking-wide flex items-center gap-1.5">
            <AudioLines size={11} /> Music
          </p>
          <p className="text-[11.5px] text-mute mt-1.5 leading-relaxed">{plan.music}</p>
        </div>
      </div>

      {plan.reference ? (
        <p className="text-[12px] text-chalk-dim leading-relaxed flex items-start gap-2">
          <Activity size={13} className="text-signal shrink-0 mt-0.5" />
          {plan.reference}
        </p>
      ) : null}

      {/* Items */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-eyebrow">
            {plan.items.length} suggestion{plan.items.length === 1 ? "" : "s"}
          </p>
          {canApply ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setPicked(
                    picked.size === plan.items.length
                      ? new Set()
                      : new Set(plan.items.map((i) => i.id)),
                  )
                }
                className="text-[11.5px] text-mute hover:text-chalk"
              >
                {picked.size === plan.items.length ? "Clear" : "Select all"}
              </button>
              <Button
                size="sm"
                variant="ghost"
                icon={<ListPlus size={13} />}
                disabled={picked.size === 0}
                loading={applying}
                onClick={onApply}
              >
                Add {picked.size || ""} to cut list
              </Button>
            </div>
          ) : null}
        </div>

        <ul className="space-y-1.5">
          {plan.items.map((item) => {
            const style = labelStyle(item.type);
            const on = picked.has(item.id);
            return (
              <li
                key={item.id}
                className={clsx(
                  "rounded-[11px] border px-3 py-2.5 transition-colors",
                  on ? "border-signal/40 bg-signal/[0.05]" : "border-white/[0.07] bg-white/[0.02]",
                )}
              >
                <div className="flex items-start gap-2.5">
                  {canApply ? (
                    <button
                      onClick={() => toggle(item.id)}
                      aria-pressed={on}
                      aria-label={on ? `Remove ${item.title}` : `Select ${item.title}`}
                      className={clsx(
                        "mt-0.5 size-[18px] shrink-0 grid place-items-center rounded-[6px] border transition-colors",
                        on
                          ? "bg-signal border-signal text-ink-950"
                          : "border-white/20 text-transparent hover:border-signal/60",
                      )}
                    >
                      <Check size={11} strokeWidth={3} />
                    </button>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/app/projects/${projectId}/walkthrough/${videoId}?t=${item.start_ms}`}
                        className="tabular text-[11px] text-mute hover:text-signal transition-colors"
                      >
                        {timecode(item.start_ms)}
                        {item.end_ms ? `-${timecode(item.end_ms)}` : ""}
                      </Link>
                      <span
                        className="text-[10px] uppercase tracking-wider font-medium"
                        style={{ color: style.color }}
                      >
                        {style.label}
                      </span>
                      {item.priority === "high" ? (
                        <span className="text-[10px] text-danger">high</span>
                      ) : null}
                      {item.source === "ai" ? (
                        <span className="text-[10px] text-faint inline-flex items-center gap-1">
                          <Sparkles size={9} /> ai
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[13px] text-chalk mt-1 leading-snug">{item.title}</p>
                    {item.detail ? (
                      <p className="text-[12px] text-mute mt-1 leading-relaxed">{item.detail}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Copy drafts */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-[11px] glass-soft px-3.5 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-eyebrow">Caption drafts</p>
            <button
              onClick={() => copy(plan.captions.join("\n\n"), "Captions")}
              className="text-faint hover:text-chalk"
              aria-label="Copy captions"
            >
              <Copy size={12} />
            </button>
          </div>
          <ul className="space-y-1.5">
            {plan.captions.map((caption) => (
              <li key={caption} className="text-[12px] text-chalk-dim leading-relaxed">
                {caption}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1 mt-3">
            {plan.hashtags.map((tag) => (
              <Chip key={tag}>#{tag}</Chip>
            ))}
          </div>
        </div>

        <div className="rounded-[11px] glass-soft px-3.5 py-3">
          <p className="text-eyebrow mb-2">On screen</p>
          <ul className="space-y-1.5">
            {plan.overlays.map((overlay) => (
              <li key={overlay} className="text-[12px] text-chalk-dim leading-relaxed flex gap-2">
                <span className="mt-[7px] size-1 rounded-full bg-signal/70 shrink-0" />
                {overlay}
              </li>
            ))}
          </ul>
          {plan.cover_frame_ms !== null ? (
            <p className="text-[11.5px] text-mute mt-3 flex items-center gap-1.5">
              <Clapperboard size={12} className="text-faint" />
              Cover frame: {timecode(plan.cover_frame_ms)}
            </p>
          ) : null}
          <ul className="mt-3 space-y-1">
            {plan.safe_zone.map((zone) => (
              <li key={zone} className="text-[11px] text-faint leading-relaxed">
                {zone}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
