import type { Ctx } from "../tenancy";
import { getVideo } from "../tenancy";
import { complete, parseJson, resolveLlm, visionCapable } from "../ai/llm";
import { readBuffer } from "../storage";
import { getAnalysis, listFrames, referenceTemplate } from "../analysis/store";
import { STYLE_FIELDS, type BriefValues } from "../brief";
import type { TemplatePayload } from "./store";

/**
 * A style, read off a reel.
 *
 * The rhythm is measured: median hold, cuts per minute, how much lands on the
 * beat. The look is read by the fast tier from the sampled frames. Together
 * they fill the brief's style fields, and that is a template. Nothing here
 * copies the reel; it copies the decisions the reel makes.
 */

export interface StyleProfile {
  payload: TemplatePayload;
  measured: string[];
  read: string[];
  model: string | null;
}

export class NothingToRead extends Error {}

function shotDurationFor(medianMs: number): string {
  if (medianMs <= 1500) return "0.5 to 1.5s, rapid";
  if (medianMs <= 2500) return "1 to 2.5s, fast";
  if (medianMs <= 5000) return "2 to 5s, steady";
  return "Mixed, follow the music";
}

function pacingFor(cutsPerMinute: number): string {
  if (cutsPerMinute >= 40) return "Rapid-fire, no dead air";
  if (cutsPerMinute >= 20) return "Fast and punchy";
  if (cutsPerMinute >= 8) return "Balanced";
  return "Slow and considered";
}

function transitionsFor(onBeatPct: number, bpm: number): string {
  if (bpm > 0 && onBeatPct >= 60) return "Anything, as long as it lands on the beat";
  if (onBeatPct >= 35) return "Cuts plus the odd match cut";
  return "Hard cuts only";
}

export async function styleFromReference(ctx: Ctx, videoId: string): Promise<StyleProfile> {
  const video = getVideo(ctx, videoId);
  const analysis = getAnalysis(ctx, videoId);
  const rhythm = referenceTemplate(ctx, videoId);
  if (!analysis?.payload || analysis.status !== "done" || !rhythm) {
    throw new NothingToRead("Analyse the reel first; the style is read from its shots and its beat.");
  }

  const brief: BriefValues = {};
  const measured: string[] = [];

  brief.shotDuration = shotDurationFor(rhythm.median_shot_ms);
  measured.push(`median hold ${(rhythm.median_shot_ms / 1000).toFixed(1)}s, so ${brief.shotDuration}`);
  brief.pacing = pacingFor(rhythm.cuts_per_minute);
  measured.push(`${rhythm.cuts_per_minute} cuts a minute, so ${brief.pacing}`);
  brief.transitions = transitionsFor(rhythm.on_beat_pct, rhythm.bpm);
  if (rhythm.bpm > 0) measured.push(`${Math.round(rhythm.bpm)} BPM, ${rhythm.on_beat_pct}% of cuts on the beat`);
  brief.aspect = rhythm.orientation === "portrait" ? "9:16" : rhythm.orientation === "square" ? "1:1" : "16:9";
  brief.platform = ["Instagram Reels"];
  brief.targetLength = `about ${Math.round(rhythm.duration_ms / 1000)}s`;

  const payload = analysis.payload;
  const tone: string[] = [];
  const avgBright = payload.shots.reduce((a, s) => a + s.brightness, 0) / Math.max(1, payload.shots.length);
  const avgSat = payload.shots.reduce((a, s) => a + s.saturation, 0) / Math.max(1, payload.shots.length);
  if (avgBright < 0.35) tone.push("Cinematic");
  if (avgSat > 0.45) tone.push("Hype");
  if (payload.speech.length > 0 && payload.speech.reduce((a, r) => a + r.end_ms - r.start_ms, 0) > payload.duration_ms * 0.4) tone.push("Raw and authentic");
  if (tone.length) brief.tone = tone;
  measured.push(`brightness ${avgBright.toFixed(2)}, saturation ${avgSat.toFixed(2)}`);

  const read: string[] = [];
  let model: string | null = null;

  const resolved = resolveLlm(ctx.workspace.id, "fast");
  const frames = listFrames(ctx, videoId).slice(0, 12);
  if (resolved && visionCapable(resolved.provider.id) && frames.length > 0) {
    const images = await Promise.all(
      frames.map(async (f) => ({ mime: "image/jpeg", data: (await readBuffer(f.storage_key)).toString("base64") })),
    );
    const options = Object.fromEntries(
      STYLE_FIELDS.filter((f) => f.options).map((f) => [f.key, f.options!]),
    );

    const result = await complete(ctx.workspace.id, {
      tier: "fast",
      task: "style-read",
      projectId: video.project_id,
      json: true,
      maxTokens: 900,
      images,
      system: `You describe the editing style of a short-form reel from its frames, for a creator who wants to make more like it. Describe the look and the choices, never the people. No em dashes.

Return one JSON object with these keys, each a short string unless noted:
"visualStyle" (one sentence on grain, contrast, light, handheld or locked, colour treatment),
"colourDirection" (a few words),
"hookStructure" (one of: ${options.hookStructure.join(" | ")}),
"textPlacement" (one of: ${options.textPlacement.join(" | ")}),
"category" (one of: ${options.category.join(" | ")}),
"editingRules" (two to four short rules this reel seems to follow, one per line, in one string),
"notes" (array of up to three observations about the style).`,
      user: `Frames from a ${Math.round(rhythm.duration_ms / 1000)}s ${brief.aspect} reel: ${frames.length} stills in order. Measured: ${measured.join("; ")}.`,
    });
    model = result.model;
    const parsed = parseJson<Record<string, unknown>>(result.text) ?? {};
    for (const key of ["visualStyle", "colourDirection", "hookStructure", "textPlacement", "category", "editingRules"]) {
      const value = parsed[key];
      if (typeof value !== "string" || !value.trim()) continue;
      const field = STYLE_FIELDS.find((f) => f.key === key);
      if (field?.options && !field.options.includes(value.trim())) continue;
      brief[key] = value.trim().slice(0, 1000);
      read.push(`${field?.label ?? key}: ${value.trim().slice(0, 80)}`);
    }
    if (Array.isArray(parsed.notes)) {
      const notes = parsed.notes.map((n) => String(n).slice(0, 160)).filter(Boolean).slice(0, 3);
      if (notes.length) brief.references = `${video.external_url ?? video.title}\n${notes.join("\n")}`;
    }
  }

  if (!brief.references) brief.references = video.external_url ?? video.title;
  brief.notes = `Style read from "${video.title}"${model ? ` with ${model}` : ", measured only (no AI key)"}.`;

  return {
    payload: {
      brief,
      niche: rhythm.median_shot_ms <= 2200 && rhythm.on_beat_pct >= 40 ? "gym" : rhythm.median_shot_ms <= 1500 ? "aesthetic" : "general",
      music_note: rhythm.bpm > 0 ? `About ${Math.round(rhythm.bpm)} BPM, cut on the beat` : "",
    },
    measured,
    read,
    model,
  };
}
