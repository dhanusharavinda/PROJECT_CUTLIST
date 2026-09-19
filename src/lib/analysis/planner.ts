import { timecode } from "../format";
import { niche as nicheFor, SAFE_ZONE } from "./presets";
import type {
  AnalysisPayload,
  NicheId,
  PlanItem,
  PlanPayload,
  ReferenceTemplate,
  Shot,
} from "./types";

/**
 * The offline edit plan.
 *
 * Everything here is arithmetic over the analysis: no key, no request, no
 * waiting. The AI pass rewrites and extends this, but the plan is useful on its
 * own, which is what keeps Cutlist usable before anyone pays a provider.
 */

export interface PlanInput {
  videoTitle: string;
  niche: NicheId;
  analysis: AnalysisPayload;
  brief: Record<string, string> | null;
  template: ReferenceTemplate | null;
  /** Anything the creator already said about this clip. */
  notes: { anchor_ms: number; text: string }[];
}

let counter = 0;
function itemId(): string {
  counter += 1;
  return `pi${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function make(
  item: Omit<PlanItem, "id" | "source"> & { source?: PlanItem["source"] },
): PlanItem {
  return {
    id: itemId(),
    source: item.source ?? "local",
    ...item,
    title: item.title.slice(0, 90),
    detail: item.detail.slice(0, 600),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function nearestBeat(beats: number[], ms: number): number | null {
  if (beats.length === 0) return null;
  let best = beats[0];
  for (const beat of beats) {
    if (Math.abs(beat - ms) < Math.abs(best - ms)) best = beat;
  }
  return best;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function buildLocalPlan(input: PlanInput): PlanPayload {
  const preset = nicheFor(input.niche);
  const { analysis } = input;
  const shots = analysis.shots;
  const duration = analysis.duration_ms;
  const items: PlanItem[] = [];

  const lengths = shots.map((s) => s.end_ms - s.start_ms);
  const medianShot = median(lengths);
  const [minHold, maxHold] = preset.shot_ms;

  const onBeat = analysis.beats.length
    ? shots.filter((shot) =>
        analysis.beats.some((beat) => Math.abs(beat - shot.start_ms) <= 160),
      ).length / Math.max(1, shots.length)
    : 0;

  // ── Framing ───────────────────────────────────────────────────────────────
  if (analysis.orientation !== "portrait") {
    items.push(
      make({
        type: "zoom",
        title: "Reframe to 9:16 for Reels",
        detail: `This clip is ${analysis.width}x${analysis.height}. Instagram shows 1080x1920. Punch in or reframe each shot rather than letterboxing, which wastes a third of the screen.`,
        start_ms: 0,
        end_ms: null,
        priority: "high",
        confidence: 0.95,
      }),
    );
  }

  // ── Hook: the first 1.5 seconds decide the rest ───────────────────────────
  const first = shots[0];
  let hookScore = 55;
  const hookNotes: string[] = [];

  if (first) {
    if (first.end_ms <= 1600) {
      hookScore += 15;
    } else {
      hookScore -= 10;
      hookNotes.push(`the opening shot holds for ${seconds(first.end_ms - first.start_ms)}`);
    }
    if (first.motion > 0.05) hookScore += 10;
    else hookNotes.push("almost nothing moves in it");
    if (first.brightness > 0.35) hookScore += 8;
    else hookNotes.push("it opens dark");
    if (first.saturation > 0.25) hookScore += 7;
  }

  const speechStart = analysis.speech[0]?.start_ms ?? null;
  if (analysis.has_audio && speechStart !== null && speechStart < 500) hookScore += 10;
  if (analysis.silences.some((s) => s.start_ms === 0 && s.end_ms > 600)) {
    hookScore -= 15;
    hookNotes.push("the first second is silent");
  }
  hookScore = Math.max(0, Math.min(100, hookScore));

  // The most striking shot in the first stretch, as an alternative opener.
  const candidates = shots.slice(0, 10);
  const striking = candidates.reduce<Shot | null>((best, shot) => {
    const score = shot.saturation * 0.5 + shot.motion * 3 + shot.brightness * 0.4;
    const bestScore = best
      ? best.saturation * 0.5 + best.motion * 3 + best.brightness * 0.4
      : -1;
    return score > bestScore ? shot : best;
  }, null);

  if (hookScore < 72 && striking && first && striking.idx !== first.idx) {
    items.push(
      make({
        type: "trim",
        title: `Open on the shot at ${timecode(striking.start_ms)} instead`,
        detail: `The current opener scores ${hookScore}/100${
          hookNotes.length ? ` (${hookNotes.join(", ")})` : ""
        }. The shot at ${timecode(striking.start_ms)} is brighter and busier, which holds a scroll better. Move it first, or cut straight into it inside the first 0.5s.`,
        start_ms: 0,
        end_ms: first.end_ms,
        priority: "high",
        confidence: 0.6,
      }),
    );
  }

  // ── Dead air at the top ───────────────────────────────────────────────────
  const leadIn = analysis.silences.find((s) => s.start_ms <= 80 && s.end_ms > 400);
  if (leadIn) {
    items.push(
      make({
        type: "cut",
        title: "Trim the dead air before it starts",
        detail: `Nothing is heard until ${timecode(leadIn.end_ms)}. Start on the action or the first word.`,
        start_ms: 0,
        end_ms: leadIn.end_ms,
        priority: "high",
        confidence: 0.85,
      }),
    );
  }

  // ── Total length ──────────────────────────────────────────────────────────
  if (duration > preset.length_ms[1]) {
    items.push(
      make({
        type: "trim",
        title: `Cut this down to ${Math.round(preset.length_ms[0] / 1000)} to ${Math.round(preset.length_ms[1] / 1000)} seconds`,
        detail: `The clip runs ${seconds(duration)}. ${preset.label} reels hold attention best inside that window. Drop the weakest shots rather than shortening every one.`,
        start_ms: preset.length_ms[1],
        end_ms: duration,
        priority: "normal",
        confidence: 0.7,
      }),
    );
  }

  // ── Shots that overstay ───────────────────────────────────────────────────
  const longShots = shots
    .filter((shot) => shot.end_ms - shot.start_ms > maxHold * 1.35)
    .sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms))
    .slice(0, 5);

  for (const shot of longShots) {
    const held = shot.end_ms - shot.start_ms;
    items.push(
      make({
        type: "trim",
        title: `Tighten this ${seconds(held)} hold`,
        detail: `A ${preset.label.toLowerCase()} sits best between ${seconds(minHold)} and ${seconds(maxHold)} per shot. This one runs ${seconds(held)}. Cut into the middle of the action instead of the start.`,
        start_ms: shot.start_ms,
        end_ms: shot.end_ms,
        priority: held > maxHold * 2 ? "high" : "normal",
        confidence: 0.65,
      }),
    );
  }

  // ── Music: beats and drops ────────────────────────────────────────────────
  let music: string;
  if (analysis.bpm > 0) {
    const beatMs = 60_000 / analysis.bpm;
    const perShot = Math.max(1, Math.round(minHold / beatMs));
    music = `The track runs at about ${Math.round(analysis.bpm)} BPM, a beat every ${Math.round(beatMs)}ms. Cutting ${perShot === 1 ? "on every beat" : `every ${perShot} beats`} gives roughly ${seconds(perShot * beatMs)} per shot. ${Math.round(onBeat * 100)}% of the cuts already land on a beat.`;

    if (preset.cut_on_beat) {
      const offBeat = shots
        .slice(1)
        .filter((shot) => {
          const beat = nearestBeat(analysis.beats, shot.start_ms);
          return beat !== null && Math.abs(beat - shot.start_ms) > 160;
        })
        .slice(0, 6);

      for (const shot of offBeat) {
        const beat = nearestBeat(analysis.beats, shot.start_ms);
        if (beat === null) continue;
        const drift = beat - shot.start_ms;
        items.push(
          make({
            type: "trim",
            title: `Nudge this cut ${drift > 0 ? "later" : "earlier"} onto the beat`,
            detail: `The cut sits at ${timecode(shot.start_ms)}, ${Math.abs(Math.round(drift))}ms off the beat at ${timecode(beat)}. Snapping it there is what makes a gym or aesthetic edit feel tight.`,
            start_ms: beat,
            end_ms: null,
            priority: "normal",
            confidence: 0.6,
          }),
        );
      }
    }
  } else if (analysis.has_audio) {
    music = preset.cut_on_beat
      ? "No steady tempo was found, so this is probably speech or ambient sound. A track with a clear beat is what a gym or aesthetic edit is built on: add one, then cut to it."
      : "No steady tempo was found. That is normal for a talking clip; keep music low under the voice.";
  } else {
    music = "This clip has no audio track. Add music before cutting, because the cuts should follow it.";
  }

  for (const drop of analysis.drops.slice(0, 4)) {
    items.push(
      make({
        type: "transition",
        title: `Hit the drop at ${timecode(drop)}`,
        detail:
          "The track opens up here. A hard cut, a flash frame or a whip on this exact frame is worth more than any transition effect.",
        start_ms: drop,
        end_ms: null,
        priority: "normal",
        confidence: 0.55,
      }),
    );
  }

  // ── Niche specifics ───────────────────────────────────────────────────────
  if (input.niche === "gym") {
    const peaks = [...shots]
      .sort((a, b) => b.motion_peak - a.motion_peak)
      .slice(0, 3)
      .filter((shot) => shot.motion_peak > 0.08);

    for (const shot of peaks) {
      items.push(
        make({
          type: "speed",
          title: "Slow motion on this peak",
          detail: `The most movement in the clip is here. Ramp to about 0.5x on the concentric part of the rep, then snap back to full speed on the next beat.`,
          start_ms: shot.start_ms,
          end_ms: shot.end_ms,
          priority: "normal",
          confidence: 0.55,
        }),
      );
    }

    items.push(
      make({
        type: "text",
        title: "Put the weight and reps on the first working set",
        detail:
          "One line, top third, held for about a second. It gives the viewer a reason to keep watching and it survives the caption area at the bottom.",
        start_ms: shots[0]?.start_ms ?? 0,
        end_ms: null,
        priority: "low",
        confidence: 0.5,
      }),
    );
  }

  if (input.niche === "aesthetic" || input.niche === "surreal") {
    const hues = shots.filter((s) => s.saturation > 0.12).map((s) => s.hue);
    const brightnesses = shots.map((s) => s.brightness);
    const medianHue = median(hues);
    const medianBright = median(brightnesses);

    const outliers = shots
      .filter(
        (shot) =>
          (shot.saturation > 0.12 && hueDistance(shot.hue, medianHue) > 55) ||
          Math.abs(shot.brightness - medianBright) > 0.26,
      )
      .slice(0, 5);

    for (const shot of outliers) {
      const warmer = hueDistance(shot.hue, medianHue) > 55;
      items.push(
        make({
          type: "color",
          title: warmer ? "This shot breaks the colour run" : "This shot breaks the exposure run",
          detail: warmer
            ? `Its dominant hue sits ${Math.round(hueDistance(shot.hue, medianHue))} degrees away from the rest of the clip. Pull it back towards the others in grade, or drop the shot.`
            : `It is ${shot.brightness > medianBright ? "brighter" : "darker"} than the rest by a visible margin. Match exposure so the set reads as one look.`,
          start_ms: shot.start_ms,
          end_ms: shot.end_ms,
          priority: "normal",
          confidence: 0.6,
        }),
      );
    }

    // Two shots that look alike and are far apart: a free match cut.
    outer: for (let i = 0; i < shots.length; i++) {
      for (let j = i + 2; j < shots.length; j++) {
        const a = shots[i];
        const b = shots[j];
        if (
          hueDistance(a.hue, b.hue) < 18 &&
          Math.abs(a.brightness - b.brightness) < 0.1 &&
          a.saturation > 0.15
        ) {
          items.push(
            make({
              type: "transition",
              title: `Match cut into ${timecode(b.start_ms)}`,
              detail: `These two shots share a colour and an exposure, so cutting straight from one to the other reads as a deliberate match rather than a jump. Works best on a beat.`,
              start_ms: a.end_ms,
              end_ms: null,
              priority: "low",
              confidence: 0.45,
            }),
          );
          break outer;
        }
      }
    }
  }

  if (input.niche === "surreal") {
    const stable = shots.filter((shot) => shot.stable).slice(0, 4);
    for (const shot of stable) {
      items.push(
        make({
          type: "keep",
          title: "Locked-off shot: an effect can live here",
          detail:
            "The camera barely moves through this shot, so masking, a freeze frame, a clone or a sky replacement will track cleanly. These are the only shots where that kind of work is cheap.",
          start_ms: shot.start_ms,
          end_ms: shot.end_ms,
          priority: "normal",
          confidence: 0.7,
        }),
      );
    }

    if (stable.length === 0) {
      items.push(
        make({
          type: "note",
          title: "No locked-off shots to build an effect on",
          detail:
            "Every shot moves. Masking and freeze-frame work needs a still camera. Shoot one static plate of the same scene and the effect becomes possible.",
          start_ms: 0,
          end_ms: null,
          priority: "normal",
          confidence: 0.7,
        }),
      );
    }

    const peak = [...shots].sort((a, b) => b.motion_peak - a.motion_peak)[0];
    if (peak) {
      items.push(
        make({
          type: "speed",
          title: "Freeze on the peak of this movement",
          detail:
            "A freeze at the top of the motion, held for a beat while the background keeps moving, is the cheapest surreal beat there is.",
          start_ms: peak.start_ms,
          end_ms: peak.end_ms,
          priority: "low",
          confidence: 0.45,
        }),
      );
    }
  }

  if (input.niche === "vlog" || input.niche === "general") {
    const gaps = analysis.silences
      .filter((s) => s.end_ms - s.start_ms > 600 && s.start_ms > 200)
      .slice(0, 10);

    for (const gap of gaps) {
      items.push(
        make({
          type: "cut",
          title: `Cut ${seconds(gap.end_ms - gap.start_ms)} of dead air`,
          detail: `Nothing is said between ${timecode(gap.start_ms)} and ${timecode(gap.end_ms)}. Close the gap, or put B-roll over it if the moment matters.`,
          start_ms: gap.start_ms,
          end_ms: gap.end_ms,
          priority: gap.end_ms - gap.start_ms > 1200 ? "high" : "normal",
          confidence: 0.75,
        }),
      );
    }

    // Long stretches of one shot while someone talks: the classic B-roll gap.
    const talkingHeads = shots
      .filter((shot) => {
        const held = shot.end_ms - shot.start_ms;
        if (held < 3500) return false;
        return analysis.speech.some(
          (range) =>
            range.start_ms < shot.end_ms &&
            range.end_ms > shot.start_ms &&
            Math.min(range.end_ms, shot.end_ms) - Math.max(range.start_ms, shot.start_ms) >
              2500,
        );
      })
      .slice(0, 8);

    for (const shot of talkingHeads) {
      items.push(
        make({
          type: "broll",
          title: `B-roll over this ${seconds(shot.end_ms - shot.start_ms)} of talking`,
          detail:
            "One shot holding while you talk is where people scroll. Cover it with something you shot of what you are describing, and keep the audio running underneath.",
          start_ms: shot.start_ms + 1200,
          end_ms: shot.end_ms,
          priority: "normal",
          confidence: 0.6,
        }),
      );
    }

    if (analysis.has_audio && analysis.speech.length > 0) {
      items.push(
        make({
          type: "caption",
          title: "Burn in captions",
          detail:
            "Most Reels views start muted. Burned-in captions, kept above the bottom fifth of the frame, are the difference between a scroll and a watch.",
          start_ms: 0,
          end_ms: null,
          priority: "high",
          confidence: 0.9,
        }),
      );
    }
  }

  // ── Reference reel comparison ─────────────────────────────────────────────
  let reference: string | null = null;
  if (input.template) {
    const t = input.template;
    const diff = medianShot - t.median_shot_ms;
    reference = `Reference "${t.title}": ${t.shots} shots, median hold ${seconds(t.median_shot_ms)}, ${t.cuts_per_minute} cuts a minute${t.bpm ? `, ${Math.round(t.bpm)} BPM` : ""}. This clip holds ${seconds(medianShot)}.`;

    if (Math.abs(diff) > 400) {
      items.push(
        make({
          type: "trim",
          title:
            diff > 0
              ? `Cut faster: the reference holds ${seconds(t.median_shot_ms)}`
              : `Slow down: the reference holds ${seconds(t.median_shot_ms)}`,
          detail: `Your median shot is ${seconds(medianShot)} against the reference's ${seconds(t.median_shot_ms)}. Matching the rhythm of a reel you already like is faster than guessing at pacing.`,
          start_ms: 0,
          end_ms: null,
          priority: "normal",
          confidence: 0.6,
        }),
      );
    }
  }

  // ── Safe zone, always ─────────────────────────────────────────────────────
  items.push(
    make({
      type: "text",
      title: "Keep text and faces out of Instagram's UI",
      detail: SAFE_ZONE.join(" "),
      start_ms: 0,
      end_ms: null,
      priority: "low",
      confidence: 0.9,
    }),
  );

  // ── Cover frame ───────────────────────────────────────────────────────────
  const withFrames = shots.filter((shot) => shot.frame_idx !== null);
  const cover = withFrames.reduce<Shot | null>((best, shot) => {
    const score = shot.brightness * 0.5 + shot.saturation * 0.35 + (shot.stable ? 0.15 : 0);
    const bestScore = best
      ? best.brightness * 0.5 + best.saturation * 0.35 + (best.stable ? 0.15 : 0)
      : -1;
    return score > bestScore ? shot : best;
  }, null);

  // ── Copy drafts ───────────────────────────────────────────────────────────
  const spoken = analysis.speech_text?.lines?.[0]?.text?.trim() ?? "";
  const captions: string[] = [];
  if (spoken) captions.push(spoken.slice(0, 120));
  captions.push(
    `${input.videoTitle}`.slice(0, 80),
    input.niche === "gym"
      ? "Session done. Same time tomorrow."
      : input.niche === "vlog"
        ? "A small day, start to finish."
        : "Made this one for the feeling.",
  );

  const hashtags = [...preset.hashtags];
  if (analysis.bpm > 0) hashtags.push("editing");
  if (input.niche === "aesthetic" && analysis.shots.some((s) => s.brightness < 0.3))
    hashtags.push("moody");

  const overlays = [...preset.overlays];
  if (spoken) overlays.unshift(`Open with the line: "${spoken.slice(0, 70)}"`);

  const rhythmVerdict =
    medianShot > maxHold
      ? `Holds are long for a ${preset.label.toLowerCase()}: ${seconds(medianShot)} against a ${seconds(minHold)} to ${seconds(maxHold)} target.`
      : medianShot < minHold
        ? `Cuts are fast even for a ${preset.label.toLowerCase()}: ${seconds(medianShot)} per shot. Make sure each shot reads.`
        : `Pacing is in range: ${seconds(medianShot)} per shot.`;

  const headline =
    items.find((i) => i.priority === "high")?.title ??
    (shots.length > 1
      ? `${shots.length} shots, ${seconds(medianShot)} each. ${rhythmVerdict}`
      : "One continuous shot. Cut it into moments before anything else.");

  return {
    niche: input.niche,
    headline: headline.slice(0, 140),
    read: `${shots.length} shot${shots.length === 1 ? "" : "s"} over ${seconds(duration)}${
      analysis.bpm ? ` at ${Math.round(analysis.bpm)} BPM` : ""
    }. ${rhythmVerdict} ${music}`.slice(0, 900),
    hook: {
      score: hookScore,
      verdict:
        hookScore >= 78
          ? "Strong opening"
          : hookScore >= 60
            ? "Passable opening"
            : "Weak opening",
      advice: hookNotes.length
        ? `In the first 1.5 seconds, ${hookNotes.join(", ")}. That is where most of the drop-off happens.`
        : "The first 1.5 seconds move, are lit, and cut early. Leave them alone.",
    },
    rhythm: {
      shots: shots.length,
      median_shot_ms: medianShot,
      target_ms: preset.shot_ms,
      on_beat_pct: Math.round(onBeat * 100),
      verdict: rhythmVerdict,
    },
    items: items.sort((a, b) => a.start_ms - b.start_ms).slice(0, 30),
    captions: captions.filter(Boolean).slice(0, 4),
    hashtags: Array.from(new Set(hashtags)).slice(0, 12),
    overlays: overlays.slice(0, 4),
    music,
    safe_zone: SAFE_ZONE,
    cover_frame_ms: cover ? cover.start_ms : null,
    reference,
    origin: "local",
    model: "cutlist-local",
  };
}
