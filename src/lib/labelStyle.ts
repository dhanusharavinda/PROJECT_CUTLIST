import type { LabelType } from "./types";

/**
 * Colour carries meaning only on the timeline and in type chips. Everything
 * else in the UI stays monochrome, which is what keeps these readable.
 */
export const LABEL_STYLE: Record<
  LabelType,
  { color: string; label: string; glyph: string }
> = {
  cut: { color: "#ff6b57", label: "Cut", glyph: "✂" },
  trim: { color: "#ff8f6b", label: "Trim", glyph: "⇥" },
  transition: { color: "#8aa2ff", label: "Transition", glyph: "⤫" },
  filter: { color: "#c77dff", label: "Filter", glyph: "◐" },
  color: { color: "#b48cff", label: "Colour", glyph: "◑" },
  text: { color: "#ffd166", label: "Text", glyph: "T" },
  caption: { color: "#ffc04d", label: "Captions", glyph: "≡" },
  broll: { color: "#5fd3b0", label: "B-roll", glyph: "▦" },
  sfx: { color: "#f79ad3", label: "SFX", glyph: "♪" },
  music: { color: "#e87fc4", label: "Music", glyph: "♫" },
  zoom: { color: "#6bd5ff", label: "Zoom", glyph: "⤢" },
  speed: { color: "#4fc3f7", label: "Speed", glyph: "»" },
  blur: { color: "#9aa3b2", label: "Blur", glyph: "◌" },
  keep: { color: "#d6f55e", label: "Keep", glyph: "★" },
  note: { color: "#8b94a3", label: "Note", glyph: "•" },
};

export function labelStyle(type: string) {
  return LABEL_STYLE[type as LabelType] ?? LABEL_STYLE.note;
}

export const PRIORITY_STYLE = {
  high: { label: "High", color: "#ff6b57" },
  normal: { label: "Normal", color: "#7d8593" },
  low: { label: "Low", color: "#545c6a" },
} as const;

export const STATUS_STYLE = {
  open: { label: "Open", color: "#7d8593" },
  doing: { label: "In progress", color: "#6bd5ff" },
  done: { label: "Done", color: "#5fd3b0" },
  skipped: { label: "Skipped", color: "#545c6a" },
} as const;

export const PROJECT_STATUS_STYLE = {
  briefing: { label: "Briefing", color: "#ffd166" },
  editing: { label: "Editing", color: "#6bd5ff" },
  review: { label: "In review", color: "#c77dff" },
  delivered: { label: "Delivered", color: "#5fd3b0" },
  archived: { label: "Archived", color: "#545c6a" },
} as const;
