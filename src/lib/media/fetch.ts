import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runFf } from "../analysis/ffmpeg";
import { buildKey, resolveKey } from "../storage";

/**
 * A reel by link.
 *
 * Instagram, TikTok and YouTube offer no official way to fetch a post, so this
 * leans on yt-dlp, a tool the creator installs themselves (like ffmpeg, never
 * bundled). It exists for the creator's own posts and for reels they have the
 * right to study; the UI says so. When the tool is absent, the honest answer
 * is a message and the upload button, not a scraper.
 */

const WIN = process.platform === "win32";

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function ytdlpPath(): string | null {
  const fromEnv = process.env.YTDLP_PATH;
  if (fromEnv && isFile(fromEnv)) return fromEnv;
  const name = WIN ? "yt-dlp.exe" : "yt-dlp";
  try {
    const probe = spawnSync(name, ["--version"], { timeout: 8000 });
    if (probe.status === 0) return name;
  } catch {
    /* not on PATH */
  }
  return null;
}

export const LINK_HINT =
  "Fetching a reel by link needs yt-dlp on this machine. Install it (pip install yt-dlp, or the release binary) and restart, or set YTDLP_PATH in .env.local. Or download the reel yourself and upload the file.";

export class LinkFetchUnavailable extends Error {}

const ALLOWED_HOSTS = [
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
];

export function describeLink(raw: string): { url: URL; platform: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new LinkFetchUnavailable("That does not look like a link.");
  }
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    throw new LinkFetchUnavailable(
      "Links from Instagram, TikTok and YouTube are supported. For anything else, upload the file.",
    );
  }
  const platform = url.hostname.includes("instagram")
    ? "Instagram"
    : url.hostname.includes("tiktok")
      ? "TikTok"
      : "YouTube";
  return { url, platform };
}

export interface FetchedLink {
  key: string;
  size: number;
  title: string;
  platform: string;
}

/** Bring the reel onto disk as an MP4 the browser can play. */
export async function fetchLink(workspaceId: string, raw: string): Promise<FetchedLink> {
  const tool = ytdlpPath();
  if (!tool) throw new LinkFetchUnavailable(LINK_HINT);

  const { url, platform } = describeLink(raw);
  const key = buildKey(workspaceId, "video", `${platform.toLowerCase()}-reel.mp4`);
  const abs = resolveKey(key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  // Best MP4 up to 1080p, merged with audio; yt-dlp prints the final path last.
  const result = await runFf(
    tool,
    [
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "-f",
      "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      abs,
      "--print",
      "after_move:filepath",
      "--print",
      "title",
      "--no-simulate",
      url.toString(),
    ],
    { timeoutMs: 300_000, maxStdout: 1024 * 1024 },
  );

  if (result.code !== 0 || !isFile(abs)) {
    const tail = result.stderr.split(/\r?\n/).filter(Boolean).pop() ?? "";
    throw new LinkFetchUnavailable(
      `Could not fetch that ${platform} link${tail ? `: ${tail.slice(0, 200)}` : "."} Private accounts, age gates and removed posts all end here.`,
    );
  }

  const lines = result.stdout.toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // With two --print flags the title comes after the path; take whichever is not the path.
  const title = lines.find((l) => l !== abs && !l.toLowerCase().endsWith(".mp4")) ?? `${platform} reel`;

  return { key, size: fs.statSync(abs).size, title: title.slice(0, 200), platform };
}
