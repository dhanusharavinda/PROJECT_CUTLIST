import { many } from "../db";
import type { Ctx } from "../tenancy";
import { getProject } from "../tenancy";
import { briefForPrompt, guardrailsOf, type BriefValues } from "../brief";
import { listLabels, listMessages, listNotes, listVideos, loadBrief } from "../queries";
import { listAnalyses } from "../analysis/store";
import type { Shot } from "../analysis/types";
import { reelView } from "../reel/store";
import type { ReelView } from "../reel/types";
import type { Label, Project, Video } from "../types";
import { getTemplateVersion, type TemplatePayload } from "../templates/store";
import { listEvents, type ProjectEventView } from "./events";
import { listRecommendations, type Recommendation } from "./recommendations";
import { listProjectVersions, type ProjectVersionView } from "./versions";

/**
 * The EditGraph: one read of everything the project knows.
 *
 * It is a projection, not a table. Each ingredient already lives where the UI
 * edits it (the brief, the clips, the analyses, the cut list, the reel, the
 * recommendations, the versions, the events) and this assembles them into one
 * shape for the director, the review, the AI package and the outside agent. A
 * projection cannot drift from the tables the way a second copy would.
 */

export interface GraphMedia {
  id: string;
  title: string;
  source_name: string;
  role: string;
  provider: "upload" | "google_drive" | "link";
  external_id: string | null;
  share_url: string | null;
  duration_ms: number;
  codec: string;
  fps: number;
  width: number;
  height: number;
  local_state: string;
  analysed: boolean;
  bpm: number;
  shots: number;
  warnings: string[];
  frames: { idx: number; at_ms: number; url: string }[];
}

export interface GraphShot extends Shot {
  video_id: string;
}

export interface GraphInstruction {
  id: string;
  video_id: string | null;
  type: string;
  title: string;
  detail: string;
  start_ms: number;
  end_ms: number | null;
  priority: string;
  status: string;
  origin: string;
  source: string;
  from_note: boolean;
  created_at: number;
  updated_at: number;
}

export interface GraphQuestion {
  id: string;
  label_id: string | null;
  author: string | null;
  body: string;
  created_at: number;
  answered: boolean;
}

export interface EditGraph {
  generated_at: number;
  project: Pick<
    Project,
    | "id"
    | "name"
    | "summary"
    | "status"
    | "niche"
    | "owner_state"
    | "template_id"
    | "template_version_id"
    | "footage_url"
    | "music_note"
    | "packet_rev"
    | "created_at"
    | "updated_at"
  >;
  brief: { values: BriefValues; readable: Record<string, string>; completeness: number };
  template: { id: string; name: string; version: number; payload: TemplatePayload } | null;
  guardrails: string[];
  media: GraphMedia[];
  shots: GraphShot[];
  transcripts: { video_id: string; text: string; lines: { start_ms: number; end_ms: number; text: string }[] }[];
  instructions: GraphInstruction[];
  voice_notes: { id: string; video_id: string | null; anchor_ms: number; text: string; author: string | null }[];
  recommendations: Recommendation[];
  reel: ReelView;
  versions: ProjectVersionView[];
  questions: GraphQuestion[];
  events: ProjectEventView[];
  unresolved: {
    open_instructions: number;
    proposed_recommendations: number;
    needs_review: number;
    unanswered_questions: number;
    missing_links: string[];
    conflicts: string[];
  };
}

function providerOf(video: Video): GraphMedia["provider"] {
  return video.source === "drive" ? "google_drive" : video.source;
}

/** Instructions that pull against each other or against the rules. Cheap and honest. */
function findConflicts(labels: Label[], guardrails: string[]): string[] {
  const out: string[] = [];
  const live = labels.filter((l) => l.status === "open" || l.status === "doing");

  // A keep and a cut over the same stretch of the same clip.
  for (const keep of live.filter((l) => l.type === "keep")) {
    for (const cut of live.filter((l) => l.type === "cut" && l.video_id === keep.video_id)) {
      const keepEnd = keep.end_ms ?? keep.start_ms;
      const cutEnd = cut.end_ms ?? cut.start_ms;
      if (cut.start_ms <= keepEnd && cutEnd >= keep.start_ms) {
        out.push(`"${cut.title}" cuts inside a stretch marked keep ("${keep.title}").`);
      }
    }
  }

  // A rule that names a type the instructions then ask for.
  const lowered = guardrails.map((g) => g.toLowerCase());
  for (const label of live) {
    const word = label.type === "zoom" ? "zoom" : label.type === "speed" ? "slow" : label.type === "transition" ? "transition" : null;
    if (!word) continue;
    const rule = lowered.find((g) => (g.startsWith("no ") || g.startsWith("never ") || g.startsWith("don't ") || g.startsWith("do not ")) && g.includes(word));
    if (rule) out.push(`"${label.title}" may break the rule "${rule}".`);
  }

  return out.slice(0, 20);
}

export function buildEditGraph(ctx: Ctx, projectId: string): EditGraph {
  const project = getProject(ctx, projectId);
  const brief = loadBrief(ctx, projectId);
  const videos = listVideos(ctx, projectId);
  const labels = listLabels(ctx, projectId);
  const notes = listNotes(ctx, projectId);
  const analyses = listAnalyses(ctx, projectId);
  const messages = listMessages(ctx, projectId, 400);
  const recommendations = listRecommendations(ctx, projectId);
  const reel = reelView(ctx, projectId);
  const versions = listProjectVersions(ctx, projectId);
  const events = listEvents(ctx, projectId, { limit: 400 });

  const frames = many<{ video_id: string; idx: number; at_ms: number }>(
    `SELECT f.video_id, f.idx, f.at_ms FROM analysis_frames f
       JOIN videos v ON v.id = f.video_id AND v.workspace_id = f.workspace_id
      WHERE f.workspace_id = ? AND v.project_id = ?
      ORDER BY f.video_id, f.idx`,
    ctx.workspace.id,
    projectId,
  );

  const analysisByVideo = new Map(analyses.map((a) => [a.video_id, a]));

  const media: GraphMedia[] = videos.map((video) => {
    const analysis = analysisByVideo.get(video.id);
    return {
      id: video.id,
      title: video.title,
      source_name: video.source_name || video.title,
      role: video.role,
      provider: providerOf(video),
      external_id: video.drive_file_id ?? video.external_url ?? null,
      share_url: video.share_url,
      duration_ms: video.duration_ms || analysis?.duration_ms || 0,
      codec: video.codec,
      fps: video.fps || analysis?.fps || 0,
      width: analysis?.width ?? 0,
      height: analysis?.height ?? 0,
      local_state: video.local_state,
      analysed: analysis?.status === "done",
      bpm: analysis?.bpm ?? 0,
      shots: analysis?.scene_count ?? 0,
      warnings: analysis?.payload?.warnings ?? [],
      frames: frames
        .filter((f) => f.video_id === video.id)
        .map((f) => ({ idx: f.idx, at_ms: f.at_ms, url: `/api/videos/${video.id}/frames/${f.idx}` })),
    };
  });

  const shots: GraphShot[] = analyses.flatMap((a) =>
    (a.payload?.shots ?? []).map((shot) => ({ ...shot, video_id: a.video_id })),
  );

  const transcripts = analyses
    .filter((a) => a.payload?.speech_text?.text)
    .map((a) => ({
      video_id: a.video_id,
      text: a.payload!.speech_text!.text,
      lines: a.payload!.speech_text!.lines,
    }));

  const instructions: GraphInstruction[] = labels.map((label) => ({
    id: label.id,
    video_id: label.video_id,
    type: label.type,
    title: label.title,
    detail: label.detail,
    start_ms: label.start_ms,
    end_ms: label.end_ms,
    priority: label.priority,
    status: label.status,
    origin: label.origin,
    source: label.source,
    from_note: label.note_id !== null,
    created_at: label.created_at,
    updated_at: label.updated_at,
  }));

  // A question is a room message pinned to an instruction. It is answered when
  // someone else has replied on the same instruction since.
  const questions: GraphQuestion[] = [];
  const pinned = messages
    .map((m) => {
      let labelId: string | null = null;
      try {
        labelId = m.meta ? ((JSON.parse(m.meta) as { labelId?: string }).labelId ?? null) : null;
      } catch {
        labelId = null;
      }
      return { m, labelId };
    })
    .filter((x) => x.labelId);
  for (let i = 0; i < pinned.length; i++) {
    const { m, labelId } = pinned[i];
    const answered = pinned
      .slice(i + 1)
      .some((later) => later.labelId === labelId && later.m.author_id !== m.author_id);
    questions.push({
      id: m.id,
      label_id: labelId,
      author: m.author_name,
      body: m.body,
      created_at: m.created_at,
      answered,
    });
  }

  const guardrails = guardrailsOf(brief.payload);

  let template: EditGraph["template"] = null;
  if (project.template_version_id) {
    const found = getTemplateVersion(ctx, project.template_version_id);
    if (found) {
      template = {
        id: found.version.template_id,
        name: found.template?.name ?? "Deleted template",
        version: found.version.version,
        payload: found.payload,
      };
    }
  }

  const missingLinks = reel.slots
    .filter((slot) => !slot.missing && !slot.share_url)
    .map((slot) => `Slot ${slot.idx + 1} (${slot.source_name || slot.title}) has no link the editor can open.`);

  return {
    generated_at: Date.now(),
    project: {
      id: project.id,
      name: project.name,
      summary: project.summary,
      status: project.status,
      niche: project.niche,
      owner_state: project.owner_state,
      template_id: project.template_id,
      template_version_id: project.template_version_id,
      footage_url: project.footage_url,
      music_note: project.music_note,
      packet_rev: project.packet_rev,
      created_at: project.created_at,
      updated_at: project.updated_at,
    },
    brief: {
      values: brief.payload,
      readable: briefForPrompt(brief.payload),
      completeness: brief.completeness,
    },
    template,
    guardrails,
    media,
    shots,
    transcripts,
    instructions,
    voice_notes: notes
      .filter((n) => n.text.trim())
      .map((n) => ({
        id: n.id,
        video_id: n.video_id,
        anchor_ms: n.anchor_ms,
        text: n.text,
        author: n.author_name,
      })),
    recommendations,
    reel,
    versions,
    questions,
    events,
    unresolved: {
      open_instructions: labels.filter((l) => l.status === "open" || l.status === "doing").length,
      proposed_recommendations: recommendations.filter((r) => r.status === "proposed").length,
      needs_review: recommendations.filter((r) => r.status === "needs_review").length,
      unanswered_questions: questions.filter((q) => !q.answered).length,
      missing_links: missingLinks,
      conflicts: findConflicts(labels, guardrails),
    },
  };
}

/**
 * The same graph without the bulk: what an outside agent or a model needs to
 * reason, with the event log trimmed and the frame list kept as URLs.
 */
export function compactGraph(graph: EditGraph): Omit<EditGraph, "events"> & { events: ProjectEventView[] } {
  return {
    ...graph,
    shots: graph.shots.slice(0, 400),
    events: graph.events.slice(-60),
  };
}
