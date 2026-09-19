/**
 * The creator brief.
 *
 * Declared once, here, and consumed by three places: the form renderer, the
 * completeness meter, and the AI prompt builders. Adding a field to this array
 * is the only step needed to add it everywhere.
 */

export type FieldKind = "select" | "multi" | "text" | "textarea" | "date";

export interface BriefField {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  placeholder?: string;
  options?: string[];
  /** Counts toward the completeness meter and the "ready to edit" gate. */
  required?: boolean;
}

export interface BriefSection {
  id: string;
  title: string;
  blurb: string;
  fields: BriefField[];
}

export const BRIEF_SECTIONS: BriefSection[] = [
  {
    id: "shape",
    title: "Shape of the edit",
    blurb: "What is being made, and for whom.",
    fields: [
      {
        key: "editType",
        label: "Type of edit",
        kind: "select",
        required: true,
        options: [
          "Talking head",
          "Vlog",
          "Tutorial / how-to",
          "Podcast clip",
          "Short-form hook",
          "Documentary",
          "Product / promo",
          "Gaming",
          "Event recap",
          "Music video",
          "Interview",
        ],
      },
      {
        key: "platform",
        label: "Where it goes",
        kind: "multi",
        required: true,
        options: [
          "YouTube (long)",
          "YouTube Shorts",
          "TikTok",
          "Instagram Reels",
          "LinkedIn",
          "X / Twitter",
          "Podcast feed",
          "Internal / client",
        ],
      },
      {
        key: "aspect",
        label: "Aspect ratio",
        kind: "select",
        required: true,
        options: ["16:9", "9:16", "1:1", "4:5", "21:9", "Both 16:9 and 9:16"],
      },
      {
        key: "targetLength",
        label: "Target runtime",
        kind: "text",
        placeholder: "8–10 min, or 45s for the vertical cut",
        required: true,
      },
    ],
  },
  {
    id: "feel",
    title: "Feel",
    blurb: "How it should land. This is what the AI reads to judge your notes.",
    fields: [
      {
        key: "pacing",
        label: "Pacing",
        kind: "select",
        required: true,
        options: [
          "Slow and considered",
          "Balanced",
          "Fast and punchy",
          "Rapid-fire, no dead air",
        ],
      },
      {
        key: "tone",
        label: "Tone",
        kind: "multi",
        options: [
          "Educational",
          "Funny",
          "Cinematic",
          "Raw and authentic",
          "Hype",
          "Calm",
          "Corporate",
          "Emotional",
        ],
      },
      {
        key: "references",
        label: "Reference edits",
        kind: "textarea",
        hint: "Links or channel names whose style you want matched.",
        placeholder: "https://youtu.be/…, I want the b-roll rhythm from this",
      },
    ],
  },
  {
    id: "craft",
    title: "Craft rules",
    blurb: "The recurring decisions you do not want to re-explain every project.",
    fields: [
      {
        key: "captions",
        label: "Captions",
        kind: "select",
        options: [
          "Burned-in, styled",
          "Burned-in, plain",
          "Platform auto-captions",
          "Separate .srt only",
          "None",
        ],
      },
      {
        key: "music",
        label: "Music direction",
        kind: "text",
        placeholder: "Lo-fi under the intro, nothing under the demo",
      },
      {
        key: "musicSource",
        label: "Where music comes from",
        kind: "text",
        placeholder: "Epidemic Sound (account details in the shared drive)",
      },
      {
        key: "brollSource",
        label: "B-roll source",
        kind: "text",
        placeholder: "Drive folder 'B-roll 2025', or Storyblocks",
      },
      {
        key: "branding",
        label: "Branding assets",
        kind: "textarea",
        hint: "Intro sting, lower-third template, logo, font, colour hex codes.",
      },
    ],
  },
  {
    id: "guardrails",
    title: "Guardrails",
    blurb: "The things that cause a re-edit when they get missed.",
    fields: [
      {
        key: "doNots",
        label: "Do not do",
        kind: "textarea",
        hint: "One per line.",
        placeholder:
          "No zoom effects on the intro\nNever cut mid-sentence\nDon't show the whiteboard behind me",
      },
      {
        key: "mustKeep",
        label: "Must survive the cut",
        kind: "textarea",
        hint: "Moments that are non-negotiable.",
      },
      {
        key: "sensitive",
        label: "Blur / remove",
        kind: "textarea",
        placeholder: "Any screen showing my email; the address on the parcel at 4:12",
      },
    ],
  },
  {
    id: "delivery",
    title: "Delivery",
    blurb: "What lands in the shared folder when it's done.",
    fields: [
      {
        key: "deliverables",
        label: "Deliverables",
        kind: "multi",
        required: true,
        options: [
          "Master export",
          "Vertical cut",
          "Teaser / trailer",
          "Thumbnail frames",
          "Caption file (.srt)",
          "Project file",
          "Audiogram",
        ],
      },
      { key: "deadline", label: "Due date", kind: "date", required: true },
      {
        key: "notes",
        label: "Anything else",
        kind: "textarea",
        placeholder: "Context the editor would only learn by asking.",
      },
    ],
  },
];

export const BRIEF_FIELDS: BriefField[] = BRIEF_SECTIONS.flatMap((s) => s.fields);

export type BriefValues = Record<string, string | string[]>;

function isFilled(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 0–100. Required fields are worth double, so the meter tracks "can the editor
 * actually start" rather than "how much typing has happened".
 */
export function completeness(values: BriefValues): number {
  let earned = 0;
  let total = 0;
  for (const field of BRIEF_FIELDS) {
    const weight = field.required ? 2 : 1;
    total += weight;
    if (isFilled(values[field.key])) earned += weight;
  }
  return total === 0 ? 0 : Math.round((earned / total) * 100);
}

export function missingRequired(values: BriefValues): BriefField[] {
  return BRIEF_FIELDS.filter((f) => f.required && !isFilled(values[f.key]));
}

/** Strips unknown keys so a crafted payload can't smuggle data into the AI prompt. */
export function sanitiseBrief(input: unknown): BriefValues {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: BriefValues = {};
  for (const field of BRIEF_FIELDS) {
    const value = raw[field.key];
    if (field.kind === "multi") {
      if (Array.isArray(value)) {
        const allowed = new Set(field.options ?? []);
        out[field.key] = value
          .map((v) => String(v))
          .filter((v) => (allowed.size ? allowed.has(v) : true))
          .slice(0, 20);
      }
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.slice(0, 4000);
      if (field.kind === "select" && field.options && trimmed) {
        if (!field.options.includes(trimmed)) continue;
      }
      out[field.key] = trimmed;
    }
  }
  return out;
}

/** Compact, human-readable version for prompts; skips empty fields. */
export function briefForPrompt(values: BriefValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of BRIEF_FIELDS) {
    const value = values[field.key];
    if (!isFilled(value)) continue;
    out[field.label] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
