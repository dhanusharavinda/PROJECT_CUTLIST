import { LABEL_TYPES, type LabelType } from "../types";
import { complete, hasLlm, parseJson } from "./llm";

export interface DraftLabel {
  type: LabelType;
  title: string;
  detail: string;
  start_ms: number;
  end_ms: number | null;
  priority: "low" | "normal" | "high";
  confidence: number;
}

export interface LabelInput {
  /** Full transcript (or typed text) of the note. */
  text: string;
  /** Where in the video the creator was parked when they recorded. */
  anchorMs: number;
  /** Video length, so "at the end" resolves to something real. */
  durationMs: number;
  videoTitle?: string;
  /** The creator's brief, if filled in — steers the AI pass. */
  brief?: Record<string, unknown> | null;
}

// ── Heuristic pass ──────────────────────────────────────────────────────────
//
// Runs with no API key at all, and also acts as the safety net when the LLM
// returns nothing usable. It is deliberately keyword-driven and conservative:
// a wrong label costs the editor more than a missing one.

const TYPE_RULES: { type: LabelType; patterns: RegExp[] }[] = [
  {
    type: "cut",
    patterns: [
      /\b(cut (?:this|that|it|out)?|remove|delete|get rid of|take (?:this|that|it) out|chop|drop this|scrap)\b/i,
      /\bjump ?cut\b/i,
    ],
  },
  {
    type: "trim",
    patterns: [/\b(trim|tighten|shorten|snappier|too long|drag(?:s|ging)?|speed through)\b/i],
  },
  {
    type: "transition",
    patterns: [
      /\b(transition|cross ?fade|cross ?dissolve|dissolve|whip ?pan|wipe|swipe|fade (?:in|out|to)|smash cut)\b/i,
    ],
  },
  {
    type: "filter",
    patterns: [/\b(filter|vhs|grain|glitch|vignette|film look|retro look|effect on)\b/i],
  },
  {
    type: "color",
    patterns: [
      /\b(colou?r ?grade|grading|lut|saturation|desaturat|warmer|cooler|contrast|exposure|white ?balance|too dark|too bright)\b/i,
    ],
  },
  {
    type: "text",
    patterns: [
      /\b(lower ?third|title card|on ?screen text|text overlay|callout|headline|name tag|put text|add text)\b/i,
    ],
  },
  {
    type: "caption",
    patterns: [/\b(caption|subtitle|subs\b|closed caption|cc\b|auto ?captions)\b/i],
  },
  {
    type: "broll",
    patterns: [
      /\b(b ?roll|cutaway|cut away to|stock (?:footage|clip)|insert shot|overlay (?:the )?footage|screen ?record)\b/i,
    ],
  },
  {
    type: "sfx",
    patterns: [
      /\b(sound ?effect|sfx|whoosh|swoosh|ding|boom|riser|impact sound|air ?horn|record scratch)\b/i,
    ],
  },
  {
    type: "music",
    patterns: [/\b(music|soundtrack|background track|bgm|the beat|drop the (?:song|track)|score)\b/i],
  },
  {
    type: "zoom",
    patterns: [/\b(zoom|punch ?in|push ?in|reframe|crop in|close ?up|wider shot)\b/i],
  },
  {
    type: "speed",
    patterns: [
      /\b(slow ?mo(?:tion)?|time ?lapse|speed ramp|speed (?:this|that|it) up|sped up|slow (?:this|that|it) down|\d+(?:\.\d+)?x)\b/i,
    ],
  },
  {
    type: "blur",
    patterns: [/\b(blur|censor|pixelate|bleep|mask (?:out|the)|hide (?:the|my) (?:face|name|address|screen))\b/i],
  },
  {
    type: "keep",
    patterns: [/\b(keep (?:this|that|it)|don'?t cut|leave (?:this|that|it) in|this stays|must stay)\b/i],
  },
];

const HIGH_PRIORITY =
  /\b(must|definitely|make sure|important|critical|do not forget|don'?t forget|absolutely|has to)\b/i;
const LOW_PRIORITY =
  /\b(maybe|if you (?:have|get) time|optional|nice to have|up to you|whenever|if possible)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

/**
 * Pull an absolute timestamp out of a phrase.
 * Returns null when the creator spoke relatively ("right here") — the caller
 * then falls back to the playhead anchor, which is what they meant anyway.
 */
export function extractTimestamp(
  phrase: string,
  durationMs: number,
): number | null {
  const text = phrase.toLowerCase();

  // 2:15 / 1:02:30
  const clock = text.match(/\b(?:at |around |from )?(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    const c = clock[3] ? Number(clock[3]) : null;
    const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c;
    return seconds * 1000;
  }

  // "2 minutes 15 seconds in", "at 45 seconds", "one minute thirty"
  const spoken = text.match(
    /\b(\d+|[a-z]+)\s*(?:minutes?|mins?)\b(?:\s*(?:and\s*)?(\d+|[a-z]+)\s*(?:seconds?|secs?)\b)?/,
  );
  if (spoken) {
    const mins = toNumber(spoken[1]);
    const secs = spoken[2] ? toNumber(spoken[2]) : 0;
    if (mins !== null) return (mins * 60 + (secs ?? 0)) * 1000;
  }
  const secondsOnly = text.match(/\b(?:at|around)\s+(\d+|[a-z]+)\s*(?:seconds?|secs?)\b/);
  if (secondsOnly) {
    const s = toNumber(secondsOnly[1]);
    if (s !== null) return s * 1000;
  }

  if (/\b(the )?(very )?(beginning|start|intro|top of the video)\b/.test(text)) return 0;
  if (/\b(the )?(very )?(end|outro|last bit|final)\b/.test(text) && durationMs > 0)
    return Math.max(0, durationMs - 3000);

  return null;
}

function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

/** Split into instruction-sized chunks: sentences, then "and then"/"also" joins. */
function splitInstructions(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .flatMap((sentence) =>
      sentence.split(
        /,?\s+(?:and then|then also|after that|next up|also,|oh and|plus,)\s+/i,
      ),
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

/**
 * The type is already shown as a chip everywhere a title appears, so the title
 * is just the creator's own words, tidied — no "Cut — " prefix repeating it.
 */
function titleFor(phrase: string): string {
  const cleaned = phrase
    .replace(
      /^(?:so|ok(?:ay)?|um+|uh+|like|yeah|alright|right|and|then|also)[,\s]+/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  const short = cleaned.length > 78 ? `${cleaned.slice(0, 75).trimEnd()}…` : cleaned;
  return `${short.charAt(0).toUpperCase()}${short.slice(1)}`;
}

export function heuristicLabels(input: LabelInput): DraftLabel[] {
  const chunks = splitInstructions(input.text);
  const drafts: DraftLabel[] = [];
  let carriedTimestamp: number | null = null;

  for (const chunk of chunks) {
    const explicit = extractTimestamp(chunk, input.durationMs);
    if (explicit !== null) carriedTimestamp = explicit;
    const at = explicit ?? carriedTimestamp ?? input.anchorMs;

    const matched = TYPE_RULES.filter((rule) =>
      rule.patterns.some((p) => p.test(chunk)),
    );
    if (matched.length === 0) continue;

    const title = titleFor(chunk);
    for (const rule of matched) {
      drafts.push({
        type: rule.type,
        title,
        // Only worth keeping when the title had to drop something.
        detail: chunk.trim() === title ? "" : chunk.trim(),
        start_ms: Math.max(0, Math.round(at)),
        end_ms: null,
        priority: HIGH_PRIORITY.test(chunk)
          ? "high"
          : LOW_PRIORITY.test(chunk)
            ? "low"
            : "normal",
        // Explicit timestamps mean the creator was precise; trust those more.
        confidence: explicit !== null ? 0.62 : 0.45,
      });
    }
  }

  // Nothing keyword-matched, but the creator clearly said *something*.
  if (drafts.length === 0 && input.text.trim().length > 0) {
    drafts.push({
      type: "note",
      title: titleFor(input.text),
      detail: input.text.trim(),
      start_ms: Math.max(0, Math.round(input.anchorMs)),
      end_ms: null,
      priority: "normal",
      confidence: 0.3,
    });
  }

  return dedupe(drafts);
}

/** Two rules firing on the same sentence at the same second is one instruction. */
function dedupe(drafts: DraftLabel[]): DraftLabel[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const key = `${d.type}:${Math.round(d.start_ms / 1000)}:${d.detail.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── AI pass ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You convert a video creator's spoken edit notes into a structured cut list for their editor.

The creator is talking while scrubbing through their own footage. Their speech is casual, contains filler words, and often refers to timestamps either explicitly ("at two fifteen") or relatively ("right here", "this bit"). Relative references mean the playhead position you are given.

Your job: emit one entry per distinct, actionable instruction. Split compound sentences. Never invent instructions that were not spoken. If the creator only expressed an opinion with no action ("this part is my favourite"), use type "note".

Allowed "type" values (use exactly one per entry):
${LABEL_TYPES.join(", ")}

  cut        remove footage entirely
  trim       keep it but tighten the in/out points
  transition an effect between two shots
  filter     a stylistic look/effect layered on the shot
  color      grading, exposure, white balance, LUT
  text       on-screen text, titles, lower thirds, callouts
  caption    subtitles / burned-in captions
  broll      cut away to other footage
  sfx        a one-off sound effect
  music      background music or score direction
  zoom       punch-in, reframe, crop
  speed      slow motion, timelapse, speed ramp
  blur       censor or obscure something
  keep       explicitly protect this section from cuts
  note       context for the editor with no direct action

Rules for timestamps:
- start_ms and end_ms are milliseconds from the start of THIS video.
- Use the explicit timestamp when one is spoken.
- Use the playhead position when the creator says "here" / "this bit" / "right now".
- Only set end_ms when a range was actually described ("from 1:10 to 1:25", "the next ten seconds"). Otherwise null.
- Never exceed the video duration you are given.

Output shape — a JSON object:
{"labels":[{"type":"cut","title":"short imperative under 70 chars","detail":"what the editor should actually do, in one or two sentences","start_ms":135000,"end_ms":null,"priority":"low|normal|high","confidence":0.0-1.0}]}

priority: "high" if the creator stressed it ("make sure", "definitely"), "low" if optional ("maybe", "if you have time"), otherwise "normal".
confidence: how sure you are this is a real instruction correctly placed in time.`;

export async function aiLabels(
  workspaceId: string,
  input: LabelInput,
): Promise<{ labels: DraftLabel[]; model: string } | null> {
  if (!hasLlm(workspaceId)) return null;

  const briefLine = input.brief
    ? `\nCreator's brief for this project (use it to judge style and priority):\n${JSON.stringify(input.brief).slice(0, 1800)}`
    : "";

  const user = `Video: ${input.videoTitle ?? "untitled"}
Video duration: ${input.durationMs} ms
Playhead when the note was recorded: ${input.anchorMs} ms${briefLine}

Transcript of the creator's note:
"""
${input.text.slice(0, 8000)}
"""`;

  const result = await complete(workspaceId, {
    system: SYSTEM_PROMPT,
    user,
    json: true,
    maxTokens: 2000,
  });

  const parsed = parseJson<{ labels?: unknown[] }>(result.text);
  if (!parsed?.labels || !Array.isArray(parsed.labels)) return null;

  const labels = parsed.labels
    .map((raw) => coerceDraft(raw, input))
    .filter((d): d is DraftLabel => d !== null);

  return labels.length ? { labels: dedupe(labels), model: result.model } : null;
}

function coerceDraft(raw: unknown, input: LabelInput): DraftLabel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const type = String(r.type ?? "note").toLowerCase();
  const validType = (LABEL_TYPES as readonly string[]).includes(type)
    ? (type as LabelType)
    : "note";

  const title = String(r.title ?? "").trim();
  const detail = String(r.detail ?? "").trim();
  if (!title && !detail) return null;

  const ceiling = input.durationMs > 0 ? input.durationMs : Number.MAX_SAFE_INTEGER;
  const start = clampMs(r.start_ms, input.anchorMs, ceiling);
  const rawEnd = r.end_ms;
  const end =
    rawEnd === null || rawEnd === undefined
      ? null
      : Math.max(start, clampMs(rawEnd, start, ceiling));

  const priority = ["low", "normal", "high"].includes(String(r.priority))
    ? (String(r.priority) as "low" | "normal" | "high")
    : "normal";

  const confidence = Number(r.confidence);

  return {
    type: validType,
    title: title || detail.slice(0, 70),
    detail: detail || title,
    start_ms: start,
    end_ms: end,
    priority,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0.7,
  };
}

function clampMs(value: unknown, fallback: number, ceiling: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return Math.round(fallback);
  return Math.round(Math.min(n, ceiling));
}

/**
 * Label a note: AI when a key exists, heuristics otherwise or on failure.
 * Never throws — a labelling failure must not lose the creator's note.
 */
export async function labelNote(
  workspaceId: string,
  input: LabelInput,
): Promise<{ labels: DraftLabel[]; origin: "ai" | "heuristic"; model: string }> {
  try {
    const ai = await aiLabels(workspaceId, input);
    if (ai) return { labels: ai.labels, origin: "ai", model: ai.model };
  } catch (err) {
    console.warn("[labeler] AI pass failed, using heuristics:", (err as Error).message);
  }
  return {
    labels: heuristicLabels(input),
    origin: "heuristic",
    model: "cutlist-heuristic",
  };
}
