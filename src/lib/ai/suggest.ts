import type { Label, SuggestionPayload, LabelType } from "../types";
import { complete, hasLlm, parseJson } from "./llm";
import { LABEL_TYPES } from "../types";

export interface SuggestInput {
  projectName: string;
  brief: Record<string, unknown> | null;
  videos: { title: string; duration_ms: number }[];
  transcripts: { video: string; anchor_ms: number; text: string }[];
  labels: Pick<Label, "type" | "title" | "start_ms" | "priority" | "status">[];
}

const SYSTEM_PROMPT = `You are a senior video editor reviewing a creator's brief and their spoken edit notes before the edit starts.

You are NOT re-listing what the creator already asked for. You are the second pair of eyes: what did they forget, what will bite them, what would make this edit faster or better.

Ground everything in the material you are given. Do not invent footage, timestamps, or claims about content you cannot see. When you reference a moment, use a timestamp that appears in the notes.

Output a JSON object exactly in this shape:
{
  "headline": "one sentence, max 90 chars, the single most useful thing to say",
  "read": "2-4 sentences describing what kind of edit this is and the approach you'd take",
  "items": [
    {
      "title": "short imperative, max 70 chars",
      "rationale": "why, referencing the brief or a specific note",
      "type": "one of the allowed types",
      "start_ms": 0,
      "priority": "low|normal|high",
      "effort": "quick|medium|involved"
    }
  ],
  "risks": ["things likely to go wrong or get flagged: copyright, pacing, platform limits"],
  "gaps": ["questions the editor should ask the creator before starting"]
}

Allowed "type" values: ${LABEL_TYPES.join(", ")}

Give between 3 and 8 items. Omit start_ms when no specific moment applies. Be concrete and short; an editor reads this on a phone before opening the timeline. Never use em dashes.`;

export async function suggestForProject(
  workspaceId: string,
  input: SuggestInput,
): Promise<{ payload: SuggestionPayload; model: string }> {
  if (!hasLlm(workspaceId)) {
    return { payload: heuristicSuggestions(input), model: "cutlist-heuristic" };
  }

  const user = buildUserPrompt(input);
  try {
    const result = await complete(workspaceId, {
      system: SYSTEM_PROMPT,
      user,
      json: true,
      maxTokens: 3000,
    });
    const parsed = parseJson<Partial<SuggestionPayload>>(result.text);
    if (!parsed) throw new Error("Model did not return usable JSON.");

    return {
      payload: {
        headline: String(parsed.headline ?? "Edit plan").slice(0, 140),
        read: String(parsed.read ?? "").slice(0, 900),
        items: Array.isArray(parsed.items)
          ? parsed.items.slice(0, 12).map(normaliseItem)
          : [],
        risks: toStringArray(parsed.risks).slice(0, 6),
        gaps: toStringArray(parsed.gaps).slice(0, 6),
      },
      model: result.model,
    };
  } catch (err) {
    console.warn("[suggest] falling back to heuristics:", (err as Error).message);
    return { payload: heuristicSuggestions(input), model: "cutlist-heuristic" };
  }
}

function buildUserPrompt(input: SuggestInput): string {
  const brief = input.brief
    ? JSON.stringify(input.brief, null, 1).slice(0, 2500)
    : "(not filled in yet)";

  const videos = input.videos.length
    ? input.videos
        .map((v) => `- ${v.title} (${Math.round(v.duration_ms / 1000)}s)`)
        .join("\n")
    : "(no footage attached yet)";

  const notes = input.transcripts.length
    ? input.transcripts
        .slice(0, 60)
        .map(
          (t) =>
            `[${t.video} @ ${formatMs(t.anchor_ms)}] ${t.text.replace(/\s+/g, " ").slice(0, 600)}`,
        )
        .join("\n")
    : "(no notes recorded yet)";

  const labels = input.labels.length
    ? input.labels
        .slice(0, 120)
        .map(
          (l) =>
            `${formatMs(l.start_ms)} ${l.type.toUpperCase()} [${l.priority}/${l.status}] ${l.title}`,
        )
        .join("\n")
    : "(nothing extracted yet)";

  return `PROJECT: ${input.projectName}

CREATOR'S BRIEF:
${brief}

FOOTAGE:
${videos}

CREATOR'S SPOKEN NOTES:
${notes}

ALREADY EXTRACTED INTO THE CUT LIST:
${labels}`;
}

function normaliseItem(raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const type = String(r.type ?? "note").toLowerCase();
  return {
    title: String(r.title ?? "").slice(0, 120),
    rationale: String(r.rationale ?? "").slice(0, 500),
    type: ((LABEL_TYPES as readonly string[]).includes(type)
      ? type
      : "note") as LabelType,
    start_ms:
      Number.isFinite(Number(r.start_ms)) && Number(r.start_ms) >= 0
        ? Math.round(Number(r.start_ms))
        : undefined,
    priority: (["low", "normal", "high"].includes(String(r.priority))
      ? String(r.priority)
      : "normal") as "low" | "normal" | "high",
    effort: (["quick", "medium", "involved"].includes(String(r.effort))
      ? String(r.effort)
      : "medium") as "quick" | "medium" | "involved",
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).slice(0, 300)).filter(Boolean);
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Offline fallback ────────────────────────────────────────────────────────
//
// Not a stand-in for a model, but it still reads the material and says
// something true about it. The app is fully usable before any key is added.

export function heuristicSuggestions(input: SuggestInput): SuggestionPayload {
  const items: SuggestionPayload["items"] = [];
  const risks: string[] = [];
  const gaps: string[] = [];

  const counts = new Map<string, number>();
  for (const label of input.labels)
    counts.set(label.type, (counts.get(label.type) ?? 0) + 1);

  const totalDuration = input.videos.reduce((sum, v) => sum + v.duration_ms, 0);
  const brief = (input.brief ?? {}) as Record<string, unknown>;
  const platform = String(brief.platform ?? "");
  const pacing = String(brief.pacing ?? "");

  if (!counts.get("caption") && platform && /short|tiktok|reel|vertical/i.test(platform)) {
    items.push({
      title: "Burn in captions for the whole cut",
      rationale:
        "The brief targets a sound-off-first surface. No caption instruction exists in the cut list yet.",
      type: "caption",
      priority: "high",
      effort: "medium",
    });
  }

  if (!counts.get("music")) {
    items.push({
      title: "Lock a music bed before fine-cutting",
      rationale:
        "No music direction was captured. Choosing the track first means the cuts can land on the beat instead of being retimed later.",
      type: "music",
      priority: "normal",
      effort: "quick",
    });
  }

  if ((counts.get("cut") ?? 0) + (counts.get("trim") ?? 0) === 0 && totalDuration > 0) {
    items.push({
      title: "Do a ruthless first pass for dead air",
      rationale:
        "There are no cut or trim instructions yet across " +
        `${Math.round(totalDuration / 60000)} minutes of footage. Removing pauses first makes every later note cheaper to apply.`,
      type: "trim",
      priority: "normal",
      effort: "involved",
    });
  }

  if (!counts.get("broll") && input.transcripts.length > 3) {
    items.push({
      title: "Flag talking-head stretches that need b-roll",
      rationale:
        "Several notes reference the same speaking sections. Overlaying b-roll hides the jump cuts those notes will create.",
      type: "broll",
      priority: "normal",
      effort: "medium",
    });
  }

  if (/fast|snappy|punchy|high energy/i.test(pacing)) {
    items.push({
      title: "Add punch-ins on the strongest lines",
      rationale: `The brief asks for ${pacing.toLowerCase()} pacing, so a subtle zoom on emphasis lines carries energy without new footage.`,
      type: "zoom",
      priority: "low",
      effort: "quick",
    });
  }

  const highPriority = input.labels.filter((l) => l.priority === "high").length;
  if (highPriority > 6)
    risks.push(
      `${highPriority} instructions are marked high priority. Confirm the real must-haves before starting or the deadline will slip.`,
    );
  if (counts.get("music"))
    risks.push(
      "Music was requested. Check licensing for the target platform before delivery.",
    );
  if (totalDuration > 45 * 60 * 1000)
    risks.push(
      `${Math.round(totalDuration / 60000)} minutes of source. Budget a full pass for selects before touching effects.`,
    );

  if (!input.brief || Object.keys(brief).length === 0)
    gaps.push("The creator brief has not been filled in, so aspect ratio, platform and deadline are unknown.");
  if (!brief.aspect) gaps.push("What aspect ratio should the master be delivered in?");
  if (!brief.deadline && !brief.due) gaps.push("When is this due?");
  if (input.videos.length === 0) gaps.push("No footage has been attached to the project yet.");

  const headline = input.labels.length
    ? `${input.labels.length} instruction${input.labels.length === 1 ? "" : "s"} captured across ${input.videos.length} clip${input.videos.length === 1 ? "" : "s"}.`
    : "Record a voice note over the footage to start the cut list.";

  return {
    headline,
    read:
      "Offline read: no language-model key is connected to this workspace, so this is a rules-based pass over the brief and cut list. Add a key in Settings → AI providers for a real edit plan.",
    items: items.slice(0, 6),
    risks,
    gaps,
  };
}
