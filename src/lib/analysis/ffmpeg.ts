import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Finding and running ffmpeg.
 *
 * Analysis is optional: with no binary present every feature that depends on it
 * says so and the rest of Cutlist carries on. The binary is looked up by path
 * rather than by importing `ffmpeg-static`, because the bundler rewrites
 * `__dirname` inside the server build and the package's exported path stops
 * pointing at anything real.
 */

const WIN = process.platform === "win32";

export interface FfResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function onPath(name: string): boolean {
  try {
    const probe = spawnSync(name, ["-version"], { timeout: 8000 });
    return probe.status === 0;
  } catch {
    return false;
  }
}

function candidatesFor(kind: "ffmpeg" | "ffprobe"): string[] {
  const exe = WIN ? `${kind}.exe` : kind;
  const root = process.cwd();
  const list: string[] = [];

  const fromEnv =
    kind === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (fromEnv) list.push(fromEnv);

  if (kind === "ffmpeg") {
    list.push(path.join(root, "node_modules", "ffmpeg-static", exe));
  } else {
    list.push(
      path.join(
        root,
        "node_modules",
        "ffprobe-static",
        "bin",
        process.platform,
        process.arch,
        exe,
      ),
    );
  }
  return list;
}

const globalForFf = globalThis as unknown as {
  __cutlistFf?: { ffmpeg: string | null; ffprobe: string | null };
};

function resolveAll(): { ffmpeg: string | null; ffprobe: string | null } {
  if (globalForFf.__cutlistFf) return globalForFf.__cutlistFf;

  const resolve = (kind: "ffmpeg" | "ffprobe"): string | null => {
    for (const candidate of candidatesFor(kind)) {
      if (isFile(candidate)) return candidate;
    }
    return onPath(kind) ? kind : null;
  };

  const found = { ffmpeg: resolve("ffmpeg"), ffprobe: resolve("ffprobe") };
  globalForFf.__cutlistFf = found;
  return found;
}

export function ffmpegPath(): string | null {
  return resolveAll().ffmpeg;
}

export function ffprobePath(): string | null {
  return resolveAll().ffprobe;
}

export interface FfmpegStatus {
  ok: boolean;
  ffmpeg: string | null;
  ffprobe: string | null;
  hint: string;
}

/** What Settings shows, and what the analyser checks before it starts. */
export function ffmpegStatus(): FfmpegStatus {
  const { ffmpeg, ffprobe } = resolveAll();
  const ok = Boolean(ffmpeg && ffprobe);
  return {
    ok,
    ffmpeg,
    ffprobe,
    hint: ok
      ? "Footage analysis is ready."
      : "Footage analysis needs ffmpeg. Run `npm install ffmpeg-static ffprobe-static`, or install ffmpeg yourself and set FFMPEG_PATH and FFPROBE_PATH in .env.local.",
  };
}

export class FfmpegMissing extends Error {
  constructor() {
    super(ffmpegStatus().hint);
    this.name = "FfmpegMissing";
  }
}

export function requireFfmpeg(): { ffmpeg: string; ffprobe: string } {
  const { ffmpeg, ffprobe } = resolveAll();
  if (!ffmpeg || !ffprobe) throw new FfmpegMissing();
  return { ffmpeg, ffprobe };
}

const MAX_STDOUT = 96 * 1024 * 1024;

/** Run a binary, capture stdout as bytes and the tail of stderr. */
export function runFf(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; maxStdout?: number } = {},
): Promise<FfResult> {
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const maxStdout = opts.maxStdout ?? MAX_STDOUT;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxStdout) {
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      // ffmpeg is chatty; only the tail is ever useful in an error message.
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks), stderr, code, timedOut });
    });
  });
}

/** The last meaningful line of ffmpeg's output, for an error message. */
export function ffError(result: FfResult): string {
  if (result.timedOut) return "ffmpeg timed out on this clip.";
  const line = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return line || `ffmpeg exited with code ${result.code}`;
}
