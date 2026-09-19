import { readBuffer } from "../storage";
import type { Ctx } from "../tenancy";
import { complete, parseJson, type Tier } from "../ai/llm";
import { timecode } from "../format";
import { LABEL_TYPES } from "../types";
import { listFrames } from "../analysis/store";
import { shotRecord } from "../analysis/intel";
import { buildEditGraph, type EditGraph } from "../graph/build";
import { recordEvent } from "../graph/events";
import { memoryPrompt, styleMemory, type StyleMemory } from "./memory";
import {
  proposeMany,
  RECOMMENDATION_TYPES,
  type ProposedItem,
  type Recommendation,
  type RecommendationType,
} from "../graph/recommendations";

/**
 * The AI creative director.
 *
 * One call that sees the whole project the way an editor would on day one:
 * the brief and the template it came from, the rules, what the footage
 * actually contains, what was said, what the creator has already decided, and
 * a handful of stills. It proposes; it never decides. Every proposal lands as
 * a recommendation row the creator acts on.
 *
 * The scope machinery is what makes "leave the hook alone, speed up the
 * middle" possible: a run can be limited to parts of the edit, and locked
 * parts are named to the model and filtered on the way out.
 */

export const SCOPES = ["hook", "body", "close", "audio", "text", "whole"] as const;
export type Scope = (typeof SCOPES)[number];

export class NothingToDirect extends Error {}

export interface DirectorOptions {
  /** Which parts may change. Null means everything. */
  scopes?: Scope[] | null;
  /** Parts that must not be touched, named to the model and enforced after. */
  lock?: Scope[];
  /** The creator's request, for a revision. */
  request?: string | null;
  tier?: Tier;
  /** Filled in by runDirector; here so userPrompt stays a pure function. */
  memory?: StyleMemory | null;
}

export interface DirectorResult {
  created: Recommendation[];
  runId: string;
  model: string;
  headline: string;
  scopes: Scope[] | null;
}

interface RawItem {
  type?: unknown;
  video_id?: unknown;
  start_ms?: unknown;
  end_ms?: unknown;
  title?: unknown;
  detail?: unknown;
  rationale?: unknown;
  confidence?: unknown;
  priority?: unknown;
  scope?: unknown;
}

function clipLabel(graph: EditGraph, videoId: string | null): string {
  if (!videoId) return "whole reel";
  const media = graph.media.find((m) => m.id === videoId);
  return media ? media.source_name : videoId;
}

/** The frames most worth a look: the best openers first, spread across clips. */
async function pickFrames(ctx: Ctx, graph: EditGraph, limit: number) {
  const ranked = graph.shots
    .filter((shot) => shot.frame_idx !== null)
    .sort((a, b) => (b.hook_score ?? 0) - (a.hook_score ?? 0));

  const chosen: { video_id: string; frame_idx: number; at_ms: number }[] = [];
  const perClip = new Map<string, number>();
  for (const shot of ranked) {
    const count = perClip.get(shot.video_id) ?? 0;
    if (count >= 4) continue;
    perClip.set(shot.video_id, count + 1);
    chosen.push({ video_id: shot.video_id, frame_idx: shot.frame_idx!, at_ms: shot.start_ms });
    if (chosen.length >= limit) break;
  }

  const out: { label: string; mime: string; data: string }[] = [];
  for (const pick of chosen) {
    const row = listFrames(ctx, pick.video_id).find((f) => f.idx === pick.frame_idx);
    if (!row) continue;
    try {
      out.push({
        label: `${clipLabel(graph, pick.video_id)} at ${timecode(row.at_ms)}`,
        mime: "image/jpeg",
        data: (await readBuffer(row.storage_key)).toString("base64"),
      });
    } catch {
      /* a missing still is not worth failing the pass */
    }
  }
  return out;
}

export function systemPrompt(options: DirectorOptions): string {
  const locked = options.lock?.length ? options.lock.join(", ") : "none";
  const allowed = options.scopes?.length ? options.scopes.join(", ") : "all";
  return `You are the creative director for a short-form video creator. You read everything the project knows and you propose. You never edit, and nothing you say becomes an instruction until the creator accepts it.

Parts of the edit: hook (the first fifteen percent), body, close (the last fifteen percent), audio (music and sound), text (captions and on-screen text), whole (anything project-wide).
Parts you may propose changes to: ${allowed}.
Parts that are LOCKED and must not appear in your answer at all: ${locked}.

Rules:
- Every timestamp must come from the shot list or the transcript. Never invent one.
- Do not repeat an existing creator instruction. Do not re-propose anything the creator rejected.
- Respect the creator's rules exactly. Where footage or an instruction breaks a rule, say so as type "conflict".
- Where the brief or the footage leaves something you cannot decide (which track, which take, missing footage), say so as type "missing".
- Name the strongest opener as type "hook", propose order changes as "order", shots to drop as "remove", pacing as "pacing", narrative problems as "narrative", visual inconsistencies as "inconsistency".
- Cut list types are also allowed: ${LABEL_TYPES.join(", ")}.
- Be specific to what you can see and read. Titles are commands under 70 characters. Rationale says what was measured or said and why it matters.
- No hype, no em dashes.

Respond with one JSON object:
{"headline": "one sentence", "items": [{"type": "...", "video_id": "clip id or null", "start_ms": 0, "end_ms": null, "title": "...", "detail": "what to do, 1 to 2 sentences", "rationale": "why, grounded in the data", "confidence": 0.0-1.0, "priority": "low|normal|high", "scope": "hook|body|close|audio|text|whole"}]}

Give between 6 and 16 items for a full pass, fewer for a revision.`;
}

export function userPrompt(graph: EditGraph, options: DirectorOptions): string {
  const template = graph.template
    ? `${graph.template.name} v${graph.template.version}: ${JSON.stringify(graph.template.payload.brief).slice(0, 1500)}`
    : "(none)";

  const reel = graph.reel.slots.length
    ? graph.reel.slots
        .map(
          (slot) =>
            `${slot.idx + 1}. ${slot.source_name || slot.title} ${timecode(slot.in_ms)} to ${timecode(slot.out_ms)} (${(slot.hold_ms / 1000).toFixed(1)}s)${slot.note ? `, note: ${slot.note}` : ""}`,
        )
        .join("\n")
    : "(no reel yet; the clips are in footage order)";

  const shots = graph.shots
    .slice(0, 90)
    .map((shot) => {
      const record = shotRecord(shot, shot.video_id);
      return `${clipLabel(graph, shot.video_id)} #${shot.idx + 1} ${timecode(shot.start_ms)} to ${timecode(shot.end_ms)} | ${record.movement} | hook ${record.hook_score} | bright ${shot.brightness.toFixed(2)} sat ${shot.saturation.toFixed(2)}${
        shot.intel ? ` | ${shot.intel.subject}, face ${shot.intel.face}, ${shot.intel.framing}, ${shot.intel.quality}` : ""
      }${record.notes.length ? ` | ${record.notes.join("; ")}` : ""} | clip id ${shot.video_id}`;
    })
    .join("\n");

  const music = graph.media
    .filter((m) => m.bpm > 0)
    .map((m) => `${m.source_name}: ${Math.round(m.bpm)} BPM`)
    .join(", ");

  const transcript = graph.transcripts
    .flatMap((t) =>
      t.lines.slice(0, 40).map((line) => `[${clipLabel(graph, t.video_id)} ${timecode(line.start_ms)}] ${line.text}`),
    )
    .slice(0, 80)
    .join("\n");

  const notes = graph.voice_notes
    .slice(0, 25)
    .map((n) => `[${clipLabel(graph, n.video_id)} ${timecode(n.anchor_ms)}] ${n.text.slice(0, 300)}`)
    .join("\n");

  const instructions = graph.instructions
    .filter((i) => i.status === "open" || i.status === "doing")
    .slice(0, 60)
    .map((i) => `- [${i.type}] ${clipLabel(graph, i.video_id)} ${timecode(i.start_ms)}: ${i.title}`)
    .join("\n");

  const decided = graph.recommendations
    .filter((r) => r.status === "approved" || r.status === "rejected" || r.status === "converted")
    .slice(0, 60)
    .map((r) => `- ${r.status.toUpperCase()} [${r.type}] ${r.title}`)
    .join("\n");

  const warnings = graph.media
    .flatMap((m) => m.warnings.map((w) => `${m.source_name}: ${w}`))
    .join("\n");

  return `PROJECT: ${graph.project.name} (${graph.project.niche})
${options.request ? `CREATOR'S REQUEST FOR THIS PASS: ${options.request}\n` : ""}
BRIEF: ${JSON.stringify(graph.brief.readable).slice(0, 2500)}
TEMPLATE: ${template}
RULES:
${graph.guardrails.length ? graph.guardrails.map((g) => `- ${g}`).join("\n") : "(none written)"}
MUSIC NOTE: ${graph.project.music_note || "(no track chosen)"}${music ? `\nDETECTED TEMPO: ${music}` : ""}

CLIPS: ${graph.media.map((m) => `${m.source_name} (id ${m.id}, ${(m.duration_ms / 1000).toFixed(1)}s, ${m.width}x${m.height}${m.analysed ? "" : ", not analysed"})`).join("; ")}
${warnings ? `FOOTAGE WARNINGS:\n${warnings}\n` : ""}
CURRENT REEL ORDER:
${reel}

SHOTS (measured):
${shots || "(nothing analysed yet)"}

SPOKEN IN THE FOOTAGE:
${transcript || "(no transcript)"}

CREATOR'S VOICE NOTES:
${notes || "(none)"}

OPEN CREATOR INSTRUCTIONS (already decided, do not repeat):
${instructions || "(none)"}

DECISIONS ON EARLIER SUGGESTIONS (respect these):
${decided || "(none yet)"}

${options.memory ? memoryPrompt(options.memory) : ""}

UNRESOLVED: ${graph.unresolved.open_instructions} open instructions, ${graph.unresolved.unanswered_questions} unanswered questions${graph.unresolved.conflicts.length ? `, conflicts: ${graph.unresolved.conflicts.join(" ")}` : ""}`;
}

function coerce(raw: RawItem[], graph: EditGraph, options: DirectorOptions): ProposedItem[] {
  const clipIds = new Set(graph.media.map((m) => m.id));
  const durations = new Map(graph.media.map((m) => [m.id, m.duration_ms]));
  const locked = new Set(options.lock ?? []);
  const out: ProposedItem[] = [];

  for (const item of raw.slice(0, 24)) {
    const title = String(item.title ?? "").trim();
    if (!title) continue;
    const type = String(item.type ?? "note").toLowerCase();
    if (!(RECOMMENDATION_TYPES as readonly string[]).includes(type)) continue;

    const videoId = typeof item.video_id === "string" && clipIds.has(item.video_id) ? item.video_id : null;
    const limit = videoId ? (durations.get(videoId) ?? 0) : 0;
    const start = Number(item.start_ms);
    const end = Number(item.end_ms);
    const startMs =
      Number.isFinite(start) && start >= 0 ? (limit > 0 ? Math.min(Math.round(start), limit) : Math.round(start)) : null;
    const endMs =
      Number.isFinite(end) && startMs !== null && end > startMs
        ? limit > 0
          ? Math.min(Math.round(end), limit)
          : Math.round(end)
        : null;

    let scope = String(item.scope ?? "").toLowerCase();
    if (!(SCOPES as readonly string[]).includes(scope)) {
      scope = type === "music" || type === "sfx" ? "audio" : type === "text" || type === "caption" ? "text" : startMs === null ? "whole" : limit > 0 && startMs / limit < 0.15 ? "hook" : limit > 0 && startMs / limit > 0.85 ? "close" : "body";
    }
    // Locked parts are enforced here, not trusted to the model.
    if (locked.has(scope as Scope)) continue;
    if (options.scopes && !options.scopes.includes(scope as Scope)) continue;

    const confidence = Number(item.confidence);
    const priority = String(item.priority ?? "normal");
    out.push({
      type: type as RecommendationType,
      video_id: videoId,
      title: title.slice(0, 200),
      detail: String(item.detail ?? "").trim().slice(0, 2000),
      rationale: String(item.rationale ?? "").trim().slice(0, 2000),
      start_ms: startMs,
      end_ms: endMs,
      confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.6,
      priority: (["low", "normal", "high"].includes(priority) ? priority : "normal") as ProposedItem["priority"],
      scope,
    });
  }
  return out;
}

export async function runDirector(
  ctx: Ctx,
  projectId: string,
  options: DirectorOptions = {},
): Promise<DirectorResult> {
  const graph = buildEditGraph(ctx, projectId);
  if (graph.media.length === 0) throw new NothingToDirect("Attach footage before asking the director.");
  if (!graph.media.some((m) => m.analysed)) {
    throw new NothingToDirect("Analyse at least one clip first: the director reasons over the shots, not the video.");
  }

  const frames = await pickFrames(ctx, graph, 12);
  const memory = styleMemory(ctx, projectId);
  const withMemory: DirectorOptions = { ...options, memory };

  const result = await complete(ctx.workspace.id, {
    tier: options.tier ?? "standard",
    task: options.request ? "revise" : "direct",
    projectId,
    json: true,
    maxTokens: 4000,
    system: systemPrompt(withMemory),
    user: `${userPrompt(graph, withMemory)}\n\nFRAMES ATTACHED: ${frames.map((f, i) => `${i}=${f.label}`).join(", ") || "none"}`,
    images: frames.map((f) => ({ mime: f.mime, data: f.data })),
  });

  const parsed = parseJson<{ headline?: unknown; items?: RawItem[] }>(result.text);
  const items = coerce(Array.isArray(parsed?.items) ? parsed!.items! : [], graph, options);

  const created = proposeMany(ctx, projectId, items, {
    source: `ai:${result.provider}:${result.model}`,
    runId: result.runId,
    scopes: options.scopes ?? null,
  });

  recordEvent(ctx, projectId, {
    kind: options.request ? "director.revised" : "director.ran",
    actorKind: "ai",
    subjectType: "project",
    subjectId: projectId,
    payload: {
      run_id: result.runId,
      model: result.model,
      proposed: items.length,
      scopes: options.scopes ?? ["whole"],
      locked: options.lock ?? [],
      request: options.request ?? null,
    },
  });

  return {
    created,
    runId: result.runId,
    model: result.model,
    headline: String(parsed?.headline ?? "").slice(0, 200),
    scopes: options.scopes ?? null,
  };
}
