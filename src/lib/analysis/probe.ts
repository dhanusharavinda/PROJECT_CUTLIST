import { ffError, runFf } from "./ffmpeg";

export interface Probe {
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  video_codec: string;
  audio_codec: string;
  bitrate: number;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string };
}

function rate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num)) return 0;
  if (!den) return num;
  return den === 0 ? 0 : num / den;
}

export async function probe(file: string, ffprobeBin: string): Promise<Probe> {
  const result = await runFf(
    ffprobeBin,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ],
    { timeoutMs: 60_000, maxStdout: 8 * 1024 * 1024 },
  );

  if (result.code !== 0) throw new Error(ffError(result));

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8")) as FfprobeOutput;
  } catch {
    throw new Error("ffprobe returned output this build could not read.");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  const seconds = Number(parsed.format?.duration ?? video?.duration ?? 0);
  const fps = rate(video?.avg_frame_rate) || rate(video?.r_frame_rate);

  return {
    duration_ms: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: Number.isFinite(fps) ? Math.round(fps * 100) / 100 : 0,
    has_audio: Boolean(audio),
    video_codec: video?.codec_name ?? "",
    audio_codec: audio?.codec_name ?? "",
    bitrate: Number(parsed.format?.bit_rate ?? 0) || 0,
  };
}
