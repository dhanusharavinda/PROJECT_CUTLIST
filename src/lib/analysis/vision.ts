import { noEmDashDeep, timecode } from "../format";
import { LABEL_TYPES, type LabelType } from "../types";
import { complete, parseJson, resolveLlm, visionCapable } from "../ai/llm";
import { niche as nicheFor, SAFE_ZONE } from "./presets";
import type { AnalysisPayload, PlanItem, PlanPayload, ReferenceTemplate } from "./types";

/**
 * The paid pass.
 *
 * The model never receives the video. It receives the shot table, the beat map,
 * what was said, the offline findings and a handful of stills. That is what
 * keeps a reel costing a fraction of a cent instead of a few dollars, and it is
 * also what makes the answer specific: the numbers are already true.
 */

export interface VisionInput {
  videoTitle: string;
  nicheId: string;
  analysis: AnalysisPayload;
  local: PlanPayload;
  brief: Record<string, string> | null;
  template: ReferenceTemplate | null;
  notes: { anchor_ms: number; text: string }[];
  frames: { at_ms: number; mime: string; data: string }[];
}

interface AiPlanShape {
  headline?: unknown;
  read?: unknown;
  hook?: { score?: unknown; verdict?: unknown; advice?: unknown };
  items?: unknown[];
  captions?: unknown;
  hashtags?: unknown;
  overlays?: unknown;
  music?: unknown;
  tags?: unknown;
  cover_frame_ms?: unknown;
}

function systemPrompt(nicheId: string): string {
  const preset = nicheFor(nicheId);
  return `You are a senior short-form video editor reviewing raw footage for an Instagram Reels creator. You never edit the video; you produce an edit plan the creator executes in their own editor.

${preset.guidance}

You are given measurements taken from the actual file: the shot list with timings, motion, brightness and colour, the beat grid, silences, what was said, and a set of still frames sampled from the clip. The frames are listed with their timestamps in order. Trust the measurements over your impression of the stills.

Rules:
- Every instruction must name a real moment from the shot list. Never invent a timestamp.
- Do not repeat an instruction that is already in the offline findings unless you are sharpening it.
- Be specific to what you can see. "Add a transition" is worthless; "whip pan out of the mirror shot at 0:06 into the bench shot" is not.
- Keep titles under 70 characters and write them as commands.
- Reels safe areas: ${SAFE_ZONE.join(" ")}
- Never use em dashes.

Allowed "type" values: ${LABEL_TYPES.join(", ")}

Respond with this JSON object:
{
  "headline": "one sentence, max 120 chars, the single most useful thing to say",
  "read": "2 to 4 sentences on what this clip is and how you would cut it",
  "hook": {"score": 0-100, "verdict": "short phrase", "advice": "what to do with the first 1.5 seconds"},
  "items": [{"type": "cut", "title": "short command", "detail": "what to do and why, 1 to 2 sentences", "start_ms": 0, "end_ms": null, "priority": "low|normal|high", "confidence": 0.0-1.0}],
  "captions": ["caption draft for the post"],
  "hashtags": ["without the # sign"],
  "overlays": ["on-screen text ideas with rough timing"],
  "music": "what the track is doing and how to cut to it",
  "tags": ["searchable content tags for this clip, e.g. gym, mirror, sunset, coffee"],
  "cover_frame_ms": 0
}

Give between 5 and 14 items.`;
}

function describeAnalysis(input: VisionInput): string {
  const a = input.analysis;
  const shots = a.shots
    .slice(0, 60)
    .map(
      (shot) =>
        `#${shot.idx} ${timecode(shot.start_ms)}-${timecode(shot.end_ms)} (${(
          (shot.end_ms - shot.start_ms) /
          1000
        ).toFixed(1)}s) motion ${shot.motion.toFixed(2)} peak ${shot.motion_peak.toFixed(
          2,
        )} bright ${shot.brightness.toFixed(2)} sat ${shot.saturation.toFixed(
          2,
        )} hue ${shot.hue}${shot.stable ? " locked-off" : ""}${
          shot.frame_idx !== null ? ` [frame ${shot.frame_idx}]` : ""
        }`,
    )
    .join("\n");

  const beats = a.beats.length
    ? `${Math.round(a.bpm)} BPM, ${a.beats.length} beats. First beats: ${a.beats
        .slice(0, 12)
        .map((b) => timecode(b))
        .join(", ")}${a.drops.length ? `. Drops at ${a.drops.map((d) => timecode(d)).join(", ")}` : ""}`
    : "No steady tempo detected.";

  const silences = a.silences.length
    ? a.silences
        .slice(0, 14)
        .map((s) => `${timecode(s.start_ms)}-${timecode(s.end_ms)}`)
        .join(", ")
    : "none";

  const spoken = a.speech_text?.lines?.length
    ? a.speech_text.lines
        .slice(0, 40)
        .map((line) => `[${timecode(line.start_ms)}] ${line.text}`)
        .join("\n")
    : a.speech_text?.text
      ? a.speech_text.text.slice(0, 1500)
      : "(no transcript)";

  const offline = input.local.items
    .map((item) => `- ${timecode(item.start_ms)} ${item.type}: ${item.title}`)
    .join("\n");

  const creatorNotes = input.notes.length
    ? input.notes
        .slice(0, 20)
        .map((note) => `[${timecode(note.anchor_ms)}] ${note.text.slice(0, 300)}`)
        .join("\n")
    : "(none)";

  const brief = input.brief
    ? JSON.stringify(input.brief).slice(0, 1200)
    : "(not filled in)";

  const reference = input.template
    ? `Reference reel "${input.template.title}": ${input.template.shots} shots, median hold ${input.template.median_shot_ms}ms, ${input.template.cuts_per_minute} cuts per minute, ${Math.round(input.template.bpm)} BPM, ${input.template.on_beat_pct}% of cuts on a beat.`
    : "(no reference reel)";

  return `CLIP: ${input.videoTitle}
Format: ${input.analysis.width}x${input.analysis.height} (${a.orientation}), ${(a.duration_ms / 1000).toFixed(1)}s, ${a.fps} fps, audio ${a.has_audio ? "yes" : "no"}
Niche preset: ${nicheFor(input.nicheId).label}

SHOTS:
${shots}

MUSIC: ${beats}
SILENCES: ${silences}

SPOKEN:
${spoken}

OFFLINE FINDINGS (already shown to the creator):
${offline}

CREATOR'S NOTES ON THIS CLIP:
${creatorNotes}

BRIEF: ${brief}
REFERENCE: ${reference}

FRAMES ATTACHED: ${input.frames.length ? input.frames.map((f, i) => `${i}=${timecode(f.at_ms)}`).join(", ") : "none"}`;
}

function coerceItems(raw: unknown[], durationMs: number): PlanItem[] {
  const items: PlanItem[] = [];
  for (const entry of raw.slice(0, 20)) {
    const r = (entry ?? {}) as Record<string, unknown>;
    const title = String(r.title ?? "").trim();
    if (!title) continue;

    const type = String(r.type ?? "note").toLowerCase();
    const start = Number(r.start_ms);
    const end = Number(r.end_ms);
    const priority = String(r.priority ?? "normal");
    const confidence = Number(r.confidence);

    items.push({
      id: `ai${items.length}${Math.random().toString(36).slice(2, 7)}`,
      type: ((LABEL_TYPES as readonly string[]).includes(type)
        ? type
        : "note") as LabelType,
      title: title.slice(0, 90),
      detail: String(r.detail ?? "").trim().slice(0, 600),
      start_ms:
        Number.isFinite(start) && start >= 0
          ? Math.min(Math.round(start), Math.max(0, durationMs))
          : 0,
      end_ms:
        Number.isFinite(end) && end > start
          ? Math.min(Math.round(end), Math.max(0, durationMs))
          : null,
      priority: (["low", "normal", "high"].includes(priority)
        ? priority
        : "normal") as PlanItem["priority"],
      confidence:
        Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
          ? confidence
          : 0.6,
      source: "ai",
    });
  }
  return items;
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Runs the model over the package. Returns null when no key is configured, so
 * every caller can fall back to the offline plan without special-casing.
 */
export async function aiPlan(
  workspaceId: string,
  input: VisionInput,
): Promise<{ payload: PlanPayload; tags: string[] } | null> {
  const resolved = resolveLlm(workspaceId);
  if (!resolved) return null;

  const withImages = visionCapable(resolved.provider.id) && input.frames.length > 0;

  const result = await complete(workspaceId, {
    system: systemPrompt(input.nicheId),
    user: describeAnalysis(input),
    json: true,
    maxTokens: 3000,
    images: withImages
      ? input.frames.slice(0, 12).map((frame) => ({
          mime: frame.mime,
          data: frame.data,
        }))
      : undefined,
  });

  const parsed = parseJson<AiPlanShape>(result.text);
  if (!parsed) return null;

  const aiItems = coerceItems(
    Array.isArray(parsed.items) ? parsed.items : [],
    input.analysis.duration_ms,
  );
  if (aiItems.length === 0) return null;

  // Keep an offline finding only where the model did not cover the same ground.
  const kept = input.local.items.filter(
    (local) =>
      !aiItems.some(
        (ai) => ai.type === local.type && Math.abs(ai.start_ms - local.start_ms) < 700,
      ),
  );

  const hookScore = Number(parsed.hook?.score);
  const cover = Number(parsed.cover_frame_ms);

  const payload: PlanPayload = {
    niche: input.local.niche,
    headline: String(parsed.headline ?? input.local.headline).slice(0, 140),
    read: String(parsed.read ?? input.local.read).slice(0, 900),
    hook: {
      score:
        Number.isFinite(hookScore) && hookScore >= 0 && hookScore <= 100
          ? Math.round(hookScore)
          : input.local.hook.score,
      verdict: String(parsed.hook?.verdict ?? input.local.hook.verdict).slice(0, 60),
      advice: String(parsed.hook?.advice ?? input.local.hook.advice).slice(0, 400),
    },
    rhythm: input.local.rhythm,
    items: [...aiItems, ...kept].sort((a, b) => a.start_ms - b.start_ms).slice(0, 30),
    captions: strings(parsed.captions, 4).length
      ? strings(parsed.captions, 4)
      : input.local.captions,
    hashtags: strings(parsed.hashtags, 12).length
      ? strings(parsed.hashtags, 12).map((tag) => tag.replace(/^#/, ""))
      : input.local.hashtags,
    overlays: strings(parsed.overlays, 5).length
      ? strings(parsed.overlays, 5)
      : input.local.overlays,
    music: String(parsed.music ?? input.local.music).slice(0, 500),
    safe_zone: SAFE_ZONE,
    cover_frame_ms:
      Number.isFinite(cover) && cover >= 0
        ? Math.round(cover)
        : input.local.cover_frame_ms,
    reference: input.local.reference,
    origin: "ai",
    model: `${result.provider}:${result.model}${withImages ? " +frames" : ""}`,
  };

  return {
    payload: noEmDashDeep(payload),
    tags: strings(parsed.tags, 12).map((tag) => tag.toLowerCase()),
  };
}
