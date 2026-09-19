import { now, run } from "../db";
import type { Ctx } from "../tenancy";
import type { Video } from "../types";
import { complete, LlmUnavailable, parseJson, resolveLlm, visionCapable } from "../ai/llm";
import { readBuffer } from "../storage";
import { timecode } from "../format";
import { getAnalysis, listFrames } from "./store";
import type { ShotIntel } from "./types";

/**
 * The second stage of footage intelligence: what only eyes can see.
 *
 * The analyser has already measured every shot. This pass shows the fast tier
 * the sampled frames, one batch, and asks for the things a number cannot give:
 * who is in the frame, whether a face is readable, how it is framed, whether
 * something in it needs blurring. The answer lands on the shot rows, so the
 * director, the review and an outside agent all read one structure.
 */

const SUBJECTS = ["none", "person", "people", "object", "scene"] as const;
const FACES = ["none", "partial", "clear"] as const;
const FRAMINGS = ["wide", "medium", "close_up", "extreme_close_up", "unknown"] as const;
const QUALITIES = ["poor", "ok", "good"] as const;

interface FrameRead {
  frame?: unknown;
  subject?: unknown;
  face?: unknown;
  framing?: unknown;
  composition?: unknown;
  quality?: unknown;
  blur_candidate?: unknown;
  notes?: unknown;
}

function pick<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const s = String(value ?? "").toLowerCase().trim();
  return (allowed as readonly string[]).includes(s) ? (s as T[number]) : fallback;
}

export class NothingToEnrich extends Error {}

export async function enrichShots(
  ctx: Ctx,
  video: Video,
): Promise<{ enriched: number; model: string; runId: string }> {
  const resolved = resolveLlm(ctx.workspace.id, "fast");
  if (!resolved) throw new LlmUnavailable("No language-model key is connected. Add one in Settings.");
  if (!visionCapable(resolved.provider.id)) {
    throw new LlmUnavailable(
      `${resolved.provider.label} cannot look at frames on its default endpoint. Choose OpenAI, Anthropic or Gemini as the provider.`,
    );
  }

  const analysis = getAnalysis(ctx, video.id);
  if (!analysis?.payload || analysis.status !== "done") {
    throw new NothingToEnrich("Analyse the clip first; this pass reads the frames the analysis sampled.");
  }
  const frames = listFrames(ctx, video.id);
  if (frames.length === 0) {
    throw new NothingToEnrich("This clip has no sampled frames to look at.");
  }

  const payload = analysis.payload;
  const images = await Promise.all(
    frames.slice(0, 18).map(async (frame) => ({
      frame,
      mime: "image/jpeg",
      data: (await readBuffer(frame.storage_key)).toString("base64"),
    })),
  );

  const listing = images
    .map(({ frame }, i) => {
      const shot = payload.shots[frame.shot_idx];
      return `image ${i}: frame ${frame.idx} at ${timecode(frame.at_ms)}, shot ${frame.shot_idx + 1}${
        shot ? `, motion ${shot.motion.toFixed(2)}, brightness ${shot.brightness.toFixed(2)}` : ""
      }`;
    })
    .join("\n");

  const result = await complete(ctx.workspace.id, {
    tier: "fast",
    task: "shot-read",
    projectId: video.project_id,
    json: true,
    maxTokens: 2500,
    images: images.map((i) => ({ mime: i.mime, data: i.data })),
    system: `You read still frames from raw phone footage for a short-form video editor. For each image, describe only what is visible. Never guess identities. Never use em dashes.

For every image return one object:
{"frame": <the frame number from the listing>, "subject": "none|person|people|object|scene", "face": "none|partial|clear", "framing": "wide|medium|close_up|extreme_close_up|unknown", "composition": "three to six words on how it is framed", "quality": "poor|ok|good", "blur_candidate": true|false, "notes": ["up to three short observations useful to an editor"]}

blur_candidate is true when the frame shows something a creator usually hides: a screen with readable text, a document, an address or number plate, a bystander's face in focus, a child. quality is "poor" for blur, heavy noise, wrong exposure or an obstructed lens.

Respond with {"frames": [ ... ]} and nothing else.`,
    user: `Clip: ${video.title}
Format: ${payload.width}x${payload.height}, ${payload.shots.length} shots.

Images, in order:
${listing}`,
  });

  const parsed = parseJson<{ frames?: FrameRead[] }>(result.text);
  const reads = Array.isArray(parsed?.frames) ? parsed!.frames! : [];

  let enriched = 0;
  const byFrame = new Map(frames.map((f) => [f.idx, f]));
  for (const read of reads) {
    const frameIdx = Number(read.frame);
    const frame = Number.isFinite(frameIdx) ? byFrame.get(frameIdx) : undefined;
    if (!frame) continue;
    const shot = payload.shots[frame.shot_idx];
    if (!shot) continue;

    const intel: ShotIntel = {
      subject: pick(read.subject, SUBJECTS, "scene"),
      face: pick(read.face, FACES, "none"),
      framing: pick(read.framing, FRAMINGS, "unknown"),
      composition: String(read.composition ?? "").slice(0, 80),
      quality: pick(read.quality, QUALITIES, "ok"),
      blur_candidate: Boolean(read.blur_candidate),
      notes: Array.isArray(read.notes)
        ? read.notes.map((n) => String(n).slice(0, 120)).filter(Boolean).slice(0, 3)
        : [],
    };
    shot.intel = intel;
    enriched += 1;
  }

  payload.enriched = { at: now(), model: result.model, frames: enriched };

  run(
    "UPDATE analyses SET payload = ?, updated_at = ? WHERE workspace_id = ? AND video_id = ?",
    JSON.stringify(payload),
    now(),
    ctx.workspace.id,
    video.id,
  );

  return { enriched, model: result.model, runId: result.runId };
}
