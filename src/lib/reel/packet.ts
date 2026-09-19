import fs from "node:fs";
import path from "node:path";
import { ffmpegPath } from "../analysis/ffmpeg";
import { niche } from "../analysis/presets";
import { listAnalyses, listFrames, type AnalysisView } from "../analysis/store";
import { sampleFrame } from "../analysis/video";
import { briefForPrompt, type BriefValues } from "../brief";
import { bytes, noEmDash, timecode } from "../format";
import { labelStyle } from "../labelStyle";
import {
  listLabels,
  listNotes,
  listVideos,
  loadBrief,
  type NoteWithTranscript,
} from "../queries";
import { readBuffer, removeByPrefix, resolveKey, statKey } from "../storage";
import { getProject, type Ctx } from "../tenancy";
import type { Label, LabelType, Project, Video } from "../types";
import { labelsForSlot, reelView } from "./store";
import type { ReelSlotView, ReelView } from "./types";

/**
 * Everything the handoff document says, gathered once.
 *
 * Every export format reads from here, so the markdown, the CSV, the JSON, the
 * EDL and the packet can never disagree about the order of the reel or about
 * which instruction belongs to which clip.
 *
 * The rule this module exists to enforce: the packet only ever names media the
 * editor can actually fetch. Anything less is a document that wastes their
 * afternoon, which is worse than shipping nothing.
 */

/** How far before the out point the closing still is taken, so it is not the next shot. */
const OUT_BACKOFF_MS = 120;
/** A slot that leaves less than this untouched at both ends is the whole clip. */
const WHOLE_CLIP_EDGE_MS = 250;
/** Stills stop embedding past this, so a 30 slot reel cannot produce an unemailable file. */
const STILL_BUDGET_BYTES = 2 * 1024 * 1024;
/** The scan the shot boundaries come from. Printed, because it sets the accuracy. */
export const SCAN_FPS = 5;

export interface PacketPair {
  label: string;
  value: string;
}

/** One instruction, ready to print: no ids to resolve, no lookups left. */
export interface PacketChip {
  /** The instruction id. The editor's checkbox is keyed on this and nothing else. */
  id: string;
  /** Every instruction this chip stands for: more than one when duplicates were hoisted. */
  ids: string[];
  type: LabelType;
  type_label: string;
  color: string;
  title: string;
  detail: string;
  priority: Label["priority"];
  done: boolean;
  /** Where it lands inside the clip, blank when it applies to the whole reel. */
  at: string;
  /** The real filename, set only on instructions printed away from their slot. */
  clip: string;
}

export interface PacketStill {
  kind: "in" | "out" | "whole" | "nearest";
  /** What the editor is looking at. A fallback frame says so, rather than posing as the in point. */
  label: string;
  at_ms: number;
  /** Inline jpeg, or null when the budget ran out or ffmpeg could not reach the file. */
  data_uri: string | null;
}

export interface PacketSlot {
  id: string;
  /** 1 based, the number printed on the section. */
  number: number;
  video_id: string;
  /** The filename in Drive. Never the app title, which the creator renames freely. */
  source_name: string;
  /** The app's own name for the clip, shown only when it differs from the filename. */
  app_title: string | null;
  size_label: string;
  link_url: string | null;
  link_label: string;
  missing: boolean;
  whole_clip: boolean;
  in_ms: number;
  out_ms: number;
  hold_ms: number;
  reel_start_ms: number;
  in_tc: string;
  out_tc: string;
  hold_label: string;
  reel_start_tc: string;
  /** "Use 00:02.40 to 00:06.10 (3.8s)". */
  range_label: string;
  note: string;
  snap: ReelSlotView["snap"];
  snap_label: string;
  stills: PacketStill[];
  instructions: PacketChip[];
  audio: string;
  /** What ffmpeg flagged about the clip, printed once per clip rather than once per slot. */
  warnings: string[];
  fps: number;
}

export interface Packet {
  project: {
    id: string;
    name: string;
    summary: string;
    niche: string;
    niche_label: string;
  };
  brief: {
    pairs: PacketPair[];
    prompt: Record<string, string>;
    payload: BriefValues;
    completeness: number;
  };
  runtime: {
    total_ms: number;
    total_label: string;
    /** The niche's target for the finished reel, which is not the per-shot hold. */
    target_ms: [number, number];
    target_label: string;
    verdict: string;
    shots: number;
    median_hold_label: string;
    /** The niche's sensible hold for one shot, which the reel view measures against. */
    hold_target_label: string;
    hold_verdict: string;
  };
  slots: PacketSlot[];
  /** Project-wide instructions, plus the advice that repeated on every slot. */
  whole_reel: PacketChip[];
  /** Said against a clip, but outside every slot. Printed so trimming cannot delete it silently. */
  orphans: PacketChip[];
  music: { note: string; line: string };
  footage_url: string | null;
  packet_rev: number;
  built_at: number;
  built_label: string;
  counts: { slots: number; instructions: number; skipped: number };
  accuracy: { scan_fps: number; tolerance_ms: number };
  /** Distinct clip frame rates, so the EDL can refuse to drift. */
  frame_rates: number[];
  slug: string;
  /** localStorage namespace for the editor's ticks: per project, never per revision. */
  tick_key: string;
  /** The raw rows, for the formats that want data rather than a document. */
  source: {
    project: Project;
    videos: Video[];
    labels: Label[];
    notes: NoteWithTranscript[];
    analyses: AnalysisView[];
    reel: ReelView;
    titleById: Map<string, string>;
  };
}

function clean(text: string | null | undefined): string {
  return noEmDash(String(text ?? "")).trim();
}

function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function atOf(label: Label): string {
  const start = timecode(label.start_ms, true);
  return label.end_ms && label.end_ms > label.start_ms
    ? `${start} to ${timecode(label.end_ms, true)}`
    : start;
}

function chipOf(label: Label, clip: string): PacketChip {
  const style = labelStyle(label.type);
  const detail = clean(label.detail);
  const title = clean(label.title);
  return {
    id: label.id,
    ids: [label.id],
    type: label.type,
    type_label: style.label,
    color: style.color,
    title,
    detail: detail === title ? "" : detail,
    priority: label.priority,
    done: label.status === "done",
    at: label.video_id ? atOf(label) : "",
    clip,
  };
}

/**
 * The advice the planner appends to every clip, said once.
 *
 * Safe-area and caption rules arrive as a separate instruction per clip, so an
 * eight shot reel would otherwise print the same paragraph eight times and bury
 * the advice that only applies to one shot.
 */
function hoistShared(slots: PacketSlot[]): PacketChip[] {
  if (slots.length < 2) return [];

  const groups = new Map<
    string,
    { chip: PacketChip; slots: Set<string>; ids: string[]; done: boolean }
  >();
  for (const slot of slots) {
    for (const chip of slot.instructions) {
      const key = `${chip.type}|${chip.title.toLowerCase()}|${chip.detail.toLowerCase()}`;
      const group = groups.get(key) ?? {
        chip,
        slots: new Set<string>(),
        ids: [],
        done: true,
      };
      group.slots.add(slot.id);
      group.ids.push(chip.id);
      group.done = group.done && chip.done;
      groups.set(key, group);
    }
  }

  // Half the reel is the line between "a rule for the edit" and "a note that
  // happens to apply twice". Two slots is the floor, so a two shot reel works.
  const threshold = Math.max(2, Math.ceil(slots.length / 2));
  const hoisted: PacketChip[] = [];
  const taken = new Set<string>();

  for (const group of groups.values()) {
    if (group.slots.size < threshold) continue;
    hoisted.push({
      ...group.chip,
      ids: group.ids,
      done: group.done,
      at: "",
      clip: "",
    });
    for (const id of group.ids) taken.add(id);
  }

  for (const slot of slots) {
    slot.instructions = slot.instructions.filter((chip) => !taken.has(chip.id));
  }
  return hoisted;
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** What the editor should do with the sound under this slot. */
function audioLine(slot: ReelSlotView, analysis: AnalysisView | undefined): string {
  if (slot.missing) return "Clip is missing, so its audio is unknown.";
  const payload = analysis?.payload;
  if (!payload) return "Audio was never analysed. Listen before you drop it.";
  if (!payload.has_audio) return "Silent clip, nothing to keep.";
  const speech = payload.speech.some((range) =>
    overlaps(slot.in_ms, slot.out_ms, range.start_ms, range.end_ms),
  );
  return speech
    ? "There is speech in this range. Keep the clip audio audible under the music."
    : "No speech in this range. The music can carry it.";
}

function musicLine(note: string): string {
  const trimmed = clean(note);
  return trimmed
    ? trimmed
    : "The track is not chosen yet. Cut to the rhythm of the shots and leave the audio swap for a second pass.";
}

function snapLabel(snap: ReelSlotView["snap"]): string {
  if (snap === "shot") return "Snapped to a detected cut";
  if (snap === "beat") return "Snapped to a beat";
  return "Times set by hand";
}

function verdictFor(total: number, target: [number, number]): string {
  if (total === 0) return "Nothing is in the reel yet";
  if (total < target[0]) return `Short of the ${seconds(target[0])} floor`;
  if (total > target[1]) return `Over the ${seconds(target[1])} ceiling`;
  return "Inside the target";
}

/** A clip the packet can point at: Drive's own link, or a plain URL for a linked file. */
function linkFor(video: Video | undefined, slot: ReelSlotView): string | null {
  if (!video) return slot.share_url;
  if (video.share_url) return video.share_url;
  if (video.source === "link" && video.external_url) return video.external_url;
  return null;
}

// ── Stills ──────────────────────────────────────────────────────────────────
//
// Deliberately NOT the analysis thumbnails. The analyser keeps one frame per
// sampled shot, gated by an every-Nth-shot step, so a single take clip has one
// jpeg for its whole length and "the frame nearest the in point" hands the
// editor footage the row above it tells them to cut. These are grabbed at the
// slot's own in and out, so "use 00:02.40 to 00:06.10" shows those two frames.

function localFileFor(video: Video | undefined): string | null {
  if (!video) return null;
  for (const key of [video.storage_key, video.proxy_key]) {
    if (key && statKey(key)) return key;
  }
  return null;
}

/** What a cached still is called: the clip and the moment, nothing else. */
function stillName(videoId: string, kind: PacketStill["kind"], atMs: number): string {
  return `${videoId}-${kind}-${Math.round(atMs)}.jpg`;
}

async function grab(
  ctx: Ctx,
  slot: ReelSlotView,
  source: string,
  ffmpeg: string,
  kind: PacketStill["kind"],
  atMs: number,
): Promise<string | null> {
  // Keyed by the clip and the moment, never by the slot: slot ids are rewritten
  // on every save, so a slot-keyed cache orphaned every still on each reorder.
  const key = `${ctx.workspace.id}/packet/${stillName(slot.video_id, kind, atMs)}`;
  if (!statKey(key)) {
    await sampleFrame(source, ffmpeg, atMs, resolveKey(key));
  }
  if (!statKey(key)) return null;
  const buffer = await readBuffer(key);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function stillsFor(
  ctx: Ctx,
  slot: ReelSlotView,
  video: Video | undefined,
  frames: () => ReturnType<typeof listFrames>,
  ffmpeg: string | null,
  budget: { used: number },
): Promise<PacketStill[]> {
  if (slot.missing) return [];

  const wholeClip =
    slot.in_ms <= WHOLE_CLIP_EDGE_MS &&
    slot.duration_ms > 0 &&
    slot.out_ms >= slot.duration_ms - WHOLE_CLIP_EDGE_MS;

  const source = localFileFor(video);
  const out: PacketStill[] = [];

  if (source && ffmpeg) {
    const wants: { kind: PacketStill["kind"]; at: number; label: string }[] =
      wholeClip
        ? [
            {
              kind: "whole",
              at: Math.min(slot.in_ms + 150, Math.max(slot.in_ms, slot.out_ms - OUT_BACKOFF_MS)),
              label: "Whole clip, nothing trimmed",
            },
          ]
        : [
            { kind: "in", at: slot.in_ms, label: `In at ${timecode(slot.in_ms, true)}` },
            {
              kind: "out",
              at: Math.max(slot.in_ms, slot.out_ms - OUT_BACKOFF_MS),
              label: `Out at ${timecode(slot.out_ms, true)}`,
            },
          ];

    for (const want of wants) {
      const overBudget = budget.used >= STILL_BUDGET_BYTES;
      const uri = overBudget
        ? null
        : await grab(ctx, slot, resolveKey(source), ffmpeg, want.kind, want.at);
      if (uri) budget.used += uri.length;
      out.push({ kind: want.kind, label: want.label, at_ms: Math.round(want.at), data_uri: uri });
    }
    if (out.some((still) => still.data_uri)) return out;
    out.length = 0;
  }

  // No local file, or no ffmpeg on this machine. The analyser's frame is the
  // only picture available, and it is labelled for what it is so nobody reads
  // it as the in point.
  const rows = frames();
  const row =
    (slot.frame_idx !== null
      ? rows.find((frame) => frame.idx === slot.frame_idx)
      : null) ??
    rows
      .slice()
      .sort(
        (a, b) =>
          Math.abs(a.at_ms - slot.in_ms) - Math.abs(b.at_ms - slot.in_ms),
      )[0];
  if (!row) return [];

  let uri: string | null = null;
  if (budget.used < STILL_BUDGET_BYTES && statKey(row.storage_key)) {
    try {
      const buffer = await readBuffer(row.storage_key);
      uri = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      budget.used += uri.length;
    } catch {
      uri = null;
    }
  }
  return [
    {
      kind: "nearest",
      label: `Nearest detected cut at ${timecode(row.at_ms)}, not the in point`,
      at_ms: row.at_ms,
      data_uri: uri,
    },
  ];
}

// ── Build ───────────────────────────────────────────────────────────────────

export interface PacketOptions {
  /** Off for the text formats: a still costs an ffmpeg seek and only the document prints them. */
  stills?: boolean;
}

export async function buildPacket(
  ctx: Ctx,
  projectId: string,
  options: PacketOptions = {},
): Promise<Packet> {
  const wantsStills = options.stills !== false;
  const project = getProject(ctx, projectId);
  const videos = listVideos(ctx, projectId);
  const labels = listLabels(ctx, projectId);
  const notes = listNotes(ctx, projectId);
  const brief = loadBrief(ctx, projectId);
  const analyses = listAnalyses(ctx, projectId);
  const reel = reelView(ctx, projectId);

  const videoById = new Map(videos.map((v) => [v.id, v]));
  const titleById = new Map(videos.map((v) => [v.id, v.title]));
  const analysisByVideo = new Map(analyses.map((a) => [a.video_id, a]));
  const framesByVideo = new Map<string, ReturnType<typeof listFrames>>();
  const ffmpeg = ffmpegPath();
  const budget = { used: 0 };

  const live = labels.filter((label) => label.status !== "skipped");
  const insideSlots = new Set<string>();
  const warnedFor = new Set<string>();
  const slots: PacketSlot[] = [];

  for (const slot of reel.slots) {
    const video = videoById.get(slot.video_id);
    const analysis = analysisByVideo.get(slot.video_id);
    const chips = labelsForSlot(slot, live);
    for (const label of chips) insideSlots.add(label.id);

    const filename = clean(slot.source_name) || clean(video?.source_name) || "Unnamed file";
    const appTitle = clean(slot.title ?? video?.title ?? "");
    const wholeClip =
      slot.in_ms <= WHOLE_CLIP_EDGE_MS &&
      slot.duration_ms > 0 &&
      slot.out_ms >= slot.duration_ms - WHOLE_CLIP_EDGE_MS;
    const link = linkFor(video, slot);

    // One clip can fill two slots; its warnings are about the file, not the
    // range, so they are printed the first time the file appears.
    const firstUse = !warnedFor.has(slot.video_id);
    warnedFor.add(slot.video_id);

    // The analyser's frames are read at most once per clip, and only when a
    // slot has to fall back to them.
    const frames = () => {
      const cached = framesByVideo.get(slot.video_id);
      if (cached) return cached;
      const rows = listFrames(ctx, slot.video_id);
      framesByVideo.set(slot.video_id, rows);
      return rows;
    };
    const stills = wantsStills
      ? await stillsFor(ctx, slot, video, frames, ffmpeg, budget)
      : [];

    slots.push({
      id: slot.id,
      number: slot.idx + 1,
      video_id: slot.video_id,
      source_name: filename,
      app_title: appTitle && appTitle !== filename ? appTitle : null,
      size_label: video?.size_bytes ? bytes(video.size_bytes) : "size unknown",
      link_url: link,
      link_label: video?.source === "link" ? "Open the file" : "Open in Drive",
      missing: slot.missing,
      whole_clip: wholeClip,
      in_ms: slot.in_ms,
      out_ms: slot.out_ms,
      hold_ms: slot.hold_ms,
      reel_start_ms: slot.reel_start_ms,
      in_tc: timecode(slot.in_ms, true),
      out_tc: timecode(slot.out_ms, true),
      hold_label: seconds(slot.hold_ms),
      reel_start_tc: timecode(slot.reel_start_ms, true),
      range_label: wholeClip
        ? `Use all of it (${seconds(slot.hold_ms)})`
        : `Use ${timecode(slot.in_ms, true)} to ${timecode(slot.out_ms, true)} (${seconds(slot.hold_ms)})`,
      note: clean(slot.note),
      snap: slot.snap,
      snap_label: snapLabel(slot.snap),
      stills,
      instructions: chips.map((label) => chipOf(label, filename)),
      audio: audioLine(slot, analysis),
      warnings: firstUse ? (analysis?.payload?.warnings ?? []).map(clean) : [],
      fps: video?.fps || analysis?.fps || 0,
    });
  }

  const hoisted = hoistShared(slots);
  const wholeReel = [
    ...live.filter((label) => label.video_id === null).map((label) => chipOf(label, "")),
    ...hoisted,
  ];
  const orphans = live
    .filter((label) => label.video_id !== null && !insideSlots.has(label.id))
    .map((label) =>
      chipOf(label, clean(videoById.get(label.video_id!)?.source_name) || "Unknown clip"),
    );

  const preset = niche(project.niche);
  const frameRates = [
    ...new Set(
      slots.map((slot) => Math.round(slot.fps * 100) / 100).filter((fps) => fps > 0),
    ),
  ].sort((a, b) => a - b);

  // Retrims and removals leave cached frames nothing points at. Sweeping is
  // scoped to this project's clips, so another project's cache is never touched.
  if (wantsStills) {
    const keep = new Set<string>();
    for (const slot of slots) {
      for (const still of slot.stills) {
        if (still.kind === "nearest") continue;
        keep.add(stillName(slot.video_id, still.kind, still.at_ms));
      }
    }
    await removeByPrefix(
      `${ctx.workspace.id}/packet`,
      [...new Set(slots.map((slot) => slot.video_id))],
      keep,
    );
  }

  const built = Date.now();

  return {
    project: {
      id: project.id,
      name: clean(project.name) || "Untitled reel",
      summary: clean(project.summary),
      niche: project.niche,
      niche_label: preset.label,
    },
    brief: {
      pairs: Object.entries(briefForPrompt(brief.payload)).map(([label, value]) => ({
        label,
        value: clean(value),
      })),
      prompt: briefForPrompt(brief.payload),
      payload: brief.payload,
      completeness: brief.completeness,
    },
    runtime: {
      total_ms: reel.total_ms,
      total_label: seconds(reel.total_ms),
      // The reel view's own target is the per-shot hold, so the length target
      // comes straight off the preset. Measuring a 24s reel against a 2s shot
      // would print nonsense the editor has no way to question.
      target_ms: preset.length_ms,
      target_label: `${seconds(preset.length_ms[0])} to ${seconds(preset.length_ms[1])}`,
      verdict: verdictFor(reel.total_ms, preset.length_ms),
      shots: reel.shots,
      median_hold_label: seconds(reel.median_hold_ms),
      hold_target_label: `${seconds(reel.target_ms[0])} to ${seconds(reel.target_ms[1])}`,
      hold_verdict: verdictFor(reel.median_hold_ms, reel.target_ms),
    },
    slots,
    whole_reel: wholeReel,
    orphans,
    music: { note: clean(reel.music_note || project.music_note), line: musicLine(reel.music_note || project.music_note) },
    footage_url: reel.footage_url ?? project.footage_url,
    packet_rev: reel.packet_rev ?? project.packet_rev,
    built_at: built,
    built_label: new Date(built).toLocaleString(),
    counts: {
      slots: slots.length,
      instructions:
        slots.reduce((sum, slot) => sum + slot.instructions.length, 0) +
        wholeReel.length +
        orphans.length,
      skipped: labels.filter((label) => label.status === "skipped").length,
    },
    accuracy: { scan_fps: SCAN_FPS, tolerance_ms: Math.round(1000 / SCAN_FPS / 2) },
    frame_rates: frameRates,
    slug: project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    tick_key: `cutlist-packet-${project.id}`,
    source: { project, videos, labels, notes, analyses, reel, titleById },
  };
}

/**
 * Why this packet must not be sent.
 *
 * Every reason here is a way the document would name footage the editor cannot
 * open. They have no account and no login, so a dead reference is a message
 * they cannot act on and cannot ask about.
 */
export function packetRefusals(packet: Packet): string[] {
  const reasons: string[] = [];

  if (!packet.footage_url) {
    reasons.push(
      "No footage folder is set on this reel. Paste the Drive folder link in the reel panel, because the packet carries links and not video.",
    );
  }

  for (const slot of packet.slots) {
    if (slot.missing) {
      reasons.push(
        `Slot ${slot.number} points at a clip that is gone. Put it back, or remove the slot.`,
      );
      continue;
    }
    if (!slot.link_url) {
      reasons.push(
        `Slot ${slot.number} (${slot.source_name}) has no link the editor can open. Upload the file to the reel's Drive folder and reconnect it, so the packet can point at it.`,
      );
    }
  }

  if (packet.slots.length === 0) {
    reasons.push("The reel has no slots yet, so there is nothing to hand over.");
  }

  return reasons;
}
