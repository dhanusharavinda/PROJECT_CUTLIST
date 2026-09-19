import fs from "node:fs";
import path from "node:path";
import { ffError, runFf } from "./ffmpeg";

/**
 * The picture side of the analysis: where the cuts are, how much is moving, and
 * what each shot looks like. All of it comes from two cheap ffmpeg passes, so a
 * clip can be understood before a single token is spent.
 */

const SAMPLE_FPS = 5;

export interface SceneSample {
  at_ms: number;
  score: number;
}

export interface RawShot {
  start_ms: number;
  end_ms: number;
  motion: number;
  motion_peak: number;
  stable: boolean;
}

export interface ShotLook {
  brightness: number;
  saturation: number;
  hue: number;
  palette: string[];
}

/**
 * One pass over the video at 5 fps, asking the select filter for a
 * frame-to-frame difference score and printing it as metadata. A big score is a
 * cut; the running average is how much the shot moves.
 */
export async function sceneScan(
  file: string,
  ffmpegBin: string,
): Promise<SceneSample[]> {
  const result = await runFf(
    ffmpegBin,
    [
      "-hide_banner",
      "-nostdin",
      "-v",
      "error",
      "-i",
      file,
      "-an",
      "-vf",
      `fps=${SAMPLE_FPS},scale=192:-2,select='gte(scene\\,0)',metadata=print:file=-`,
      "-f",
      "null",
      "-",
    ],
    { timeoutMs: 600_000, maxStdout: 64 * 1024 * 1024 },
  );

  if (result.code !== 0) throw new Error(ffError(result));

  const samples: SceneSample[] = [];
  let pending: number | null = null;
  for (const line of result.stdout.toString("utf8").split(/\r?\n/)) {
    const frame = line.match(/pts_time:(-?[\d.]+)/);
    if (frame) {
      const seconds = Number(frame[1]);
      pending = Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
      continue;
    }
    const score = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (score && pending !== null) {
      samples.push({ at_ms: pending, score: Number(score[1]) || 0 });
      pending = null;
    }
  }
  return samples;
}

/** Turn the difference curve into shots. */
export function shotsFrom(
  samples: SceneSample[],
  durationMs: number,
  options: { threshold?: number; minShotMs?: number } = {},
): RawShot[] {
  const threshold = options.threshold ?? 0.32;
  const minShotMs = options.minShotMs ?? 500;
  const end = durationMs > 0 ? durationMs : (samples.at(-1)?.at_ms ?? 0);
  if (samples.length === 0) {
    return end > 0
      ? [{ start_ms: 0, end_ms: end, motion: 0, motion_peak: 0, stable: false }]
      : [];
  }

  // ffmpeg scores a cut by how much the picture changed, and a change between
  // two similar frames scores low however hard the cut was. So a spike far above
  // this clip own baseline counts too: on quiet footage that catches the cuts a
  // fixed threshold sleeps through, and on busy footage the baseline rises and
  // the rule goes quiet by itself.
  const ranked = samples.map((s) => s.score).sort((x, y) => x - y);
  const baseline = ranked[Math.floor(ranked.length / 2)] ?? 0;
  const spike = Math.max(0.06, baseline * 10);

  const cuts: number[] = [0];
  for (const sample of samples) {
    if (sample.score < threshold && sample.score < spike) continue;
    if (sample.at_ms - cuts[cuts.length - 1] < minShotMs) continue;
    cuts.push(sample.at_ms);
  }

  const shots: RawShot[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i];
    const stop = i + 1 < cuts.length ? cuts[i + 1] : end;
    if (stop - start < 120) continue;

    // The frame at the cut itself is the change, not the movement inside.
    const inside = samples.filter(
      (s) =>
        s.at_ms > start + 50 &&
        s.at_ms < stop &&
        s.score < threshold &&
        s.score < spike,
    );
    const motion = inside.length
      ? inside.reduce((a, b) => a + b.score, 0) / inside.length
      : 0;
    const peak = inside.reduce((a, b) => Math.max(a, b.score), 0);

    shots.push({
      start_ms: start,
      end_ms: stop,
      motion: Math.round(motion * 1000) / 1000,
      motion_peak: Math.round(peak * 1000) / 1000,
      stable: motion < 0.02 && peak < 0.06,
    });
  }

  return shots.length
    ? shots
    : [{ start_ms: 0, end_ms: end, motion: 0, motion_peak: 0, stable: false }];
}

function hex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function toHsv(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === rn) hue = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / delta + 2);
    else hue = 60 * ((rn - gn) / delta + 4);
  }
  if (hue < 0) hue += 360;

  return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}

/** Average look of a 4x4 downscale: bright or dark, warm or cool, how colourful. */
export function lookFromRgb(buffer: Buffer): ShotLook | null {
  const pixels = Math.floor(buffer.length / 3);
  if (pixels < 4) return null;

  let sumV = 0;
  let sumS = 0;
  let hueX = 0;
  let hueY = 0;
  let hueWeight = 0;
  const swatches: { r: number; g: number; b: number; h: number; s: number; v: number }[] = [];

  for (let i = 0; i < pixels; i++) {
    const r = buffer[i * 3];
    const g = buffer[i * 3 + 1];
    const b = buffer[i * 3 + 2];
    const { h, s, v } = toHsv(r, g, b);
    sumV += v;
    sumS += s;
    const weight = s * v;
    hueX += Math.cos((h * Math.PI) / 180) * weight;
    hueY += Math.sin((h * Math.PI) / 180) * weight;
    hueWeight += weight;
    swatches.push({ r, g, b, h, s, v });
  }

  let hue = 0;
  if (hueWeight > 0) {
    hue = (Math.atan2(hueY, hueX) * 180) / Math.PI;
    if (hue < 0) hue += 360;
  }

  // A readable palette: the most colourful swatches that are not near-duplicates.
  const palette: string[] = [];
  const ranked = [...swatches].sort((a, b) => b.s * b.v - a.s * a.v);
  for (const swatch of ranked) {
    const clash = palette.some((existing) => {
      const er = parseInt(existing.slice(1, 3), 16);
      const eg = parseInt(existing.slice(3, 5), 16);
      const eb = parseInt(existing.slice(5, 7), 16);
      return (
        Math.abs(er - swatch.r) + Math.abs(eg - swatch.g) + Math.abs(eb - swatch.b) < 90
      );
    });
    if (!clash) palette.push(hex(swatch.r, swatch.g, swatch.b));
    if (palette.length === 4) break;
  }

  return {
    brightness: Math.round((sumV / pixels) * 100) / 100,
    saturation: Math.round((sumS / pixels) * 100) / 100,
    hue: Math.round(hue),
    palette,
  };
}

/**
 * Grab one frame: a thumbnail on disk for the UI and the model, plus a 4x4
 * downscale piped back for the colour maths. One seek, two outputs.
 */
export async function sampleFrame(
  file: string,
  ffmpegBin: string,
  atMs: number,
  jpegPath: string | null,
): Promise<ShotLook | null> {
  if (jpegPath) fs.mkdirSync(path.dirname(jpegPath), { recursive: true });

  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-ss",
    (Math.max(0, atMs) / 1000).toFixed(3),
    "-i",
    file,
  ];

  // Only some shots earn a thumbnail; every sampled shot gets its colour read.
  if (jpegPath) {
    args.push("-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", jpegPath);
  }
  args.push(
    "-frames:v",
    "1",
    "-vf",
    "scale=4:4",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  );

  const result = await runFf(ffmpegBin, args, {
    timeoutMs: 60_000,
    maxStdout: 4096,
  });

  if (result.code !== 0) return null;
  return lookFromRgb(result.stdout);
}
