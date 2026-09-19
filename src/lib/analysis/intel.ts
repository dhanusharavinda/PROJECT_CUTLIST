import type { Camera, Range, Shot, ShotRecord } from "./types";

/**
 * What can be said about a shot from the numbers alone.
 *
 * Camera movement, an opener score, near-duplicate takes, weak stretches and
 * B-roll candidates all fall out of measurements the analyser already made, so
 * they cost nothing and never wait on a model. The model pass in enrich.ts
 * adds what only eyes can see: subject, face, framing, blur candidates.
 */

/** How much the picture moves, in words an editor uses. */
export function cameraOf(shot: Pick<Shot, "motion" | "motion_peak">): Camera {
  if (shot.motion < 0.02 && shot.motion_peak < 0.06) return "static";
  if (shot.motion < 0.06) return "gentle";
  if (shot.motion < 0.15) return "moving";
  return "fast";
}

/** Whether speech covers a meaningful part of the shot. */
export function overlapsSpeech(shot: Pick<Shot, "start_ms" | "end_ms">, speech: Range[], minMs = 300): boolean {
  for (const range of speech) {
    const overlap = Math.min(range.end_ms, shot.end_ms) - Math.max(range.start_ms, shot.start_ms);
    if (overlap >= minMs) return true;
  }
  return false;
}

/**
 * How well a shot would open a reel, 0 to 1.
 *
 * Movement holds a scroll, colour and light read on a small screen, and a shot
 * that is busy but not chaotic beats one that is either dead or a blur. The
 * weights are deliberately simple so the number can be explained in a sentence.
 */
export function hookScoreOf(shot: Pick<Shot, "motion" | "motion_peak" | "brightness" | "saturation">): number {
  const movement = Math.min(1, shot.motion / 0.12);
  const calmPenalty = shot.motion > 0.25 ? 0.25 : 0;
  const light = 1 - Math.min(1, Math.abs(shot.brightness - 0.55) / 0.55);
  const colour = Math.min(1, shot.saturation / 0.5);
  const punch = shot.motion_peak > 0.1 ? 0.15 : 0;
  const score = 0.4 * movement + 0.25 * light + 0.25 * colour + punch - calmPenalty;
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Later shots that look the same as an earlier one: the second and third take. */
export function findDuplicates(shots: Shot[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let j = 1; j < shots.length; j++) {
    const b = shots[j];
    if (b.saturation < 0.05 && b.brightness < 0.08) continue; // black frames match everything
    for (let i = 0; i < j; i++) {
      const a = shots[i];
      if (out.has(i)) continue;
      const same =
        hueDistance(a.hue, b.hue) < 12 &&
        Math.abs(a.brightness - b.brightness) < 0.08 &&
        Math.abs(a.saturation - b.saturation) < 0.08 &&
        Math.abs(a.motion - b.motion) < 0.03;
      if (same) {
        out.set(j, i);
        break;
      }
    }
  }
  return out;
}

/** Why a shot is weak, in one phrase, or null when it is fine. */
export function weaknessOf(
  shot: Shot,
  speaking: boolean,
  duplicateOf: number | undefined,
): string | null {
  const held = shot.end_ms - shot.start_ms;
  if (shot.brightness < 0.12 && shot.saturation < 0.15) return "too dark to read";
  if (duplicateOf !== undefined) return `repeats shot ${duplicateOf + 1}`;
  if (held > 4000 && shot.motion < 0.02 && !speaking) return "long and nothing moves";
  if (held < 250) return "too short to register";
  return null;
}

/** Something to cut away to: moving picture with nobody talking over it. */
export function brollCandidate(shot: Shot, speaking: boolean, weak: string | null): boolean {
  return !speaking && weak === null && shot.motion >= 0.02 && shot.motion <= 0.15;
}

/** Fill the derived fields on every shot. Pure, so it can run on stored payloads too. */
export function intelligence(shots: Shot[], speech: Range[]): Shot[] {
  const duplicates = findDuplicates(shots);
  return shots.map((shot) => {
    const speaking = overlapsSpeech(shot, speech);
    const duplicateOf = duplicates.get(shot.idx);
    const weak = weaknessOf(shot, speaking, duplicateOf);
    return {
      ...shot,
      camera: cameraOf(shot),
      hook_score: hookScoreOf(shot),
      duplicate_of: duplicateOf ?? null,
      weak,
      broll: brollCandidate(shot, speaking, weak),
    };
  });
}

/** The structured record an outside agent reads: one shot, one object. */
export function shotRecord(shot: Shot, videoId: string): ShotRecord {
  const notes: string[] = [];
  if (shot.weak) notes.push(shot.weak);
  if (shot.duplicate_of !== null && shot.duplicate_of !== undefined) notes.push(`near duplicate of shot ${shot.duplicate_of + 1}`);
  if (shot.stable) notes.push("locked off: usable for masking or a freeze");
  if (shot.broll) notes.push("B-roll candidate");
  if (shot.intel?.blur_candidate) notes.push("contains something that may need blurring");
  for (const note of shot.intel?.notes ?? []) notes.push(note);

  const subject: ShotRecord["subject_visibility"] = shot.intel
    ? shot.intel.subject === "none"
      ? "none"
      : shot.intel.face === "clear" || shot.intel.framing === "close_up" || shot.intel.framing === "extreme_close_up"
        ? "strong"
        : "weak"
    : "unknown";

  return {
    shot_id: `${videoId}:${shot.idx}`,
    source_clip: videoId,
    start: Math.round(shot.start_ms) / 1000,
    end: Math.round(shot.end_ms) / 1000,
    movement: shot.camera ?? cameraOf(shot),
    composition: shot.intel?.framing ?? "unknown",
    subject_visibility: subject,
    hook_score: shot.hook_score ?? hookScoreOf(shot),
    notes,
  };
}
