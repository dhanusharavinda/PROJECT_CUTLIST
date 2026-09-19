import { runFf } from "./ffmpeg";
import type { Range } from "./types";

/**
 * Everything the edit needs from the soundtrack, computed here rather than by a
 * model: an energy envelope, where the silence is, the tempo, where the beats
 * land and where the track opens up.
 *
 * The audio is decoded to 8 kHz mono PCM, which is plenty for envelope work and
 * keeps a ten minute clip under 10 MB.
 */

const SAMPLE_RATE = 8000;
const HOP = 80; // 10 ms
const HOP_MS = (HOP / SAMPLE_RATE) * 1000;

export interface AudioAnalysis {
  /** One reading a second, normalised 0 to 1. The UI and the model use it. */
  energy: number[];
  hop_ms: number;
  silences: Range[];
  speech: Range[];
  bpm: number;
  beats: number[];
  beat_confidence: number;
  drops: number[];
  loudness_db: number;
}

export async function decodePcm(
  file: string,
  ffmpegBin: string,
  maxSeconds: number,
): Promise<Int16Array | null> {
  const result = await runFf(
    ffmpegBin,
    [
      "-hide_banner",
      "-nostdin",
      "-v",
      "error",
      "-t",
      String(maxSeconds),
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "-",
    ],
    { timeoutMs: 240_000, maxStdout: 64 * 1024 * 1024 },
  );

  if (result.code !== 0 || result.stdout.length < SAMPLE_RATE) return null;

  const bytes = result.stdout;
  const usable = bytes.length - (bytes.length % 2);
  const samples = new Int16Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2);
  return samples;
}

function envelopeOf(samples: Int16Array): number[] {
  const frames = Math.floor(samples.length / HOP);
  const out = new Array<number>(frames);
  let peak = 1;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * HOP;
    for (let i = start; i < start + HOP; i++) {
      const v = samples[i] / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / HOP);
    out[f] = rms;
    if (rms > peak) peak = rms;
  }
  return peak > 0 ? out.map((v) => v / peak) : out;
}

function findSilences(envelope: number[], threshold: number): Range[] {
  const out: Range[] = [];
  let runStart = -1;
  for (let i = 0; i < envelope.length; i++) {
    const quiet = envelope[i] < threshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      if ((i - runStart) * HOP_MS >= 320) {
        out.push({
          start_ms: Math.round(runStart * HOP_MS),
          end_ms: Math.round(i * HOP_MS),
        });
      }
      runStart = -1;
    }
  }
  if (runStart >= 0 && (envelope.length - runStart) * HOP_MS >= 320) {
    out.push({
      start_ms: Math.round(runStart * HOP_MS),
      end_ms: Math.round(envelope.length * HOP_MS),
    });
  }
  return out;
}

function invert(ranges: Range[], durationMs: number): Range[] {
  const out: Range[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start_ms - cursor > 200)
      out.push({ start_ms: cursor, end_ms: range.start_ms });
    cursor = Math.max(cursor, range.end_ms);
  }
  if (durationMs - cursor > 200) out.push({ start_ms: cursor, end_ms: durationMs });
  return out;
}

/** Half-wave rectified difference: rises where a new sound starts. */
function onsetStrength(envelope: number[]): number[] {
  const flux = new Array<number>(envelope.length).fill(0);
  for (let i = 1; i < envelope.length; i++) {
    flux[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  }
  // Subtract a moving average so a loud section does not outvote a quiet one.
  const window = 50;
  const smoothed = new Array<number>(flux.length).fill(0);
  let sum = 0;
  for (let i = 0; i < flux.length; i++) {
    sum += flux[i];
    if (i >= window) sum -= flux[i - window];
    const mean = sum / Math.min(i + 1, window);
    smoothed[i] = Math.max(0, flux[i] - mean);
  }
  return smoothed;
}

/**
 * Tempo by autocorrelation of the onset curve. Lags are weighted towards
 * 90 to 150 BPM, where almost all reel music sits, so the octave error that
 * plagues naive autocorrelation picks the musically sensible answer.
 */
function detectTempo(onsets: number[]): {
  bpm: number;
  lag: number;
  confidence: number;
} {
  const minLag = Math.round(60_000 / 200 / HOP_MS); // 200 BPM
  const maxLag = Math.round(60_000 / 60 / HOP_MS); // 60 BPM
  if (onsets.length < maxLag * 3) return { bpm: 0, lag: 0, confidence: 0 };

  let best = { lag: 0, score: 0 };
  let total = 0;
  let count = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < onsets.length; i++) sum += onsets[i] * onsets[i - lag];
    const bpm = 60_000 / (lag * HOP_MS);
    const centred = Math.exp(-0.5 * ((Math.log2(bpm / 120) / 0.55) ** 2));
    const score = (sum / (onsets.length - lag)) * centred;
    total += score;
    count++;
    if (score > best.score) best = { lag, score };
  }

  if (!best.lag || count === 0) return { bpm: 0, lag: 0, confidence: 0 };
  const mean = total / count;
  // How far the winning lag stands above the average lag.
  const confidence = mean > 0 ? Math.min(1, best.score / (mean * 3)) : 0;
  return {
    bpm: Math.round((60_000 / (best.lag * HOP_MS)) * 10) / 10,
    lag: best.lag,
    confidence: Math.round(confidence * 100) / 100,
  };
}

function beatGrid(onsets: number[], lag: number, durationMs: number): number[] {
  if (!lag) return [];
  let bestOffset = 0;
  let bestScore = -1;
  for (let offset = 0; offset < lag; offset++) {
    let score = 0;
    for (let i = offset; i < onsets.length; i += lag) score += onsets[i];
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  const beats: number[] = [];
  for (let i = bestOffset; i < onsets.length; i += lag) {
    const at = Math.round(i * HOP_MS);
    if (at <= durationMs) beats.push(at);
    if (beats.length > 2000) break;
  }
  return beats;
}

/** Energy jumps: a chorus opening up, a bass drop, an impact. */
function findDrops(envelope: number[], durationMs: number): number[] {
  const perSecond = Math.round(1000 / HOP_MS);
  if (envelope.length < perSecond * 4) return [];

  const seconds: number[] = [];
  for (let i = 0; i + perSecond <= envelope.length; i += perSecond) {
    let sum = 0;
    for (let j = i; j < i + perSecond; j++) sum += envelope[j];
    seconds.push(sum / perSecond);
  }

  const sorted = [...seconds].sort((a, b) => a - b);
  const high = sorted[Math.floor(sorted.length * 0.75)] || 0;
  const drops: number[] = [];
  for (let i = 2; i < seconds.length; i++) {
    const before = (seconds[i - 2] + seconds[i - 1]) / 2;
    const jump = before > 0.02 ? seconds[i] / before : seconds[i] > 0.15 ? 2 : 0;
    if (jump >= 1.55 && seconds[i] >= high) {
      const at = i * 1000;
      if (at <= durationMs && (drops.length === 0 || at - drops[drops.length - 1] > 4000)) {
        drops.push(at);
      }
    }
  }
  return drops.slice(0, 12);
}

export async function analyzeAudio(
  file: string,
  ffmpegBin: string,
  durationMs: number,
): Promise<AudioAnalysis | null> {
  const maxSeconds = Math.min(900, Math.max(1, Math.ceil(durationMs / 1000) + 1));
  const samples = await decodePcm(file, ffmpegBin, maxSeconds);
  if (!samples) return null;

  const envelope = envelopeOf(samples);
  if (envelope.length === 0) return null;

  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  const silenceThreshold = Math.max(0.04, mean * 0.35);
  const silences = findSilences(envelope, silenceThreshold);
  const speech = invert(silences, durationMs);

  const onsets = onsetStrength(envelope);
  const tempo = detectTempo(onsets);
  const musical = tempo.confidence >= 0.35 && tempo.bpm >= 60;

  const rms = Math.sqrt(
    envelope.reduce((a, b) => a + b * b, 0) / envelope.length,
  );

  // One reading a second is enough for the UI and for the model package.
  const perSecond = Math.round(1000 / HOP_MS);
  const energy: number[] = [];
  for (let i = 0; i + perSecond <= envelope.length; i += perSecond) {
    let sum = 0;
    for (let j = i; j < i + perSecond; j++) sum += envelope[j];
    energy.push(Math.round((sum / perSecond) * 100) / 100);
  }

  return {
    energy,
    hop_ms: HOP_MS,
    silences,
    speech,
    bpm: musical ? tempo.bpm : 0,
    beats: musical ? beatGrid(onsets, tempo.lag, durationMs) : [],
    beat_confidence: tempo.confidence,
    drops: findDrops(envelope, durationMs),
    loudness_db: rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -70,
  };
}
