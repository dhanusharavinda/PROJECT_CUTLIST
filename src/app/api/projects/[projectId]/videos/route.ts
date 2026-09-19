import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, many, now, one, run, tx } from "@/lib/db";
import { assert, badRequest, can, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { listVideos } from "@/lib/queries";
import { enqueueLocalize } from "@/lib/media/localize";
import type { Video } from "@/lib/types";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  return json({ videos: listVideos(ctx, projectId) });
});

const Item = z.object({
  title: z.string().trim().min(1).max(200),
  source: z.enum(["drive", "link"]),
  externalUrl: z.string().trim().url().optional(),
  driveFileId: z.string().trim().optional(),
  mime: z.string().trim().max(100).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  /** The filename in Drive, extension included: what the editor searches for. */
  sourceName: z.string().trim().max(300).optional(),
  /** Google's own link to the file. */
  shareUrl: z.string().trim().url().optional(),
  driveParentId: z.string().trim().max(200).optional(),
});

/** One clip, or a folder's worth of them in a single request. */
const Create = z.union([
  Item,
  z.object({
    items: z.array(Item).min(1).max(20),
    /** The Drive folder the editor will be sent to. */
    footageUrl: z.string().trim().url().optional(),
  }),
]);

/**
 * Attach footage that lives elsewhere: Drive files, or a direct URL.
 *
 * A batch is one request, one transaction and one realtime event, because
 * attaching nine clips used to mean nine of each and a visible stutter. Drive
 * clips then queue a local copy: without a file on disk there are no
 * thumbnails, no shots, no beats and no reliable scrubbing.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.uploadMedia(ctx.role), "Viewers cannot attach footage.");

  const parsed = Create.parse(await body(req));
  const items = "items" in parsed ? parsed.items : [parsed];
  const footageUrl = "items" in parsed ? parsed.footageUrl : undefined;

  for (const item of items) {
    if (item.source === "drive" && !item.driveFileId)
      throw badRequest("A Drive file id is required.");
    if (item.source === "link" && !item.externalUrl)
      throw badRequest("A URL is required.");
  }

  const startPosition =
    one<{ n: number }>(
      "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM videos WHERE project_id = ? AND workspace_id = ?",
      projectId,
      ctx.workspace.id,
    )?.n ?? 0;

  const ids: string[] = [];

  tx(() => {
    items.forEach((item, index) => {
      const videoId = id("vid");
      ids.push(videoId);
      run(
        `INSERT INTO videos
           (id, workspace_id, project_id, title, source, storage_key, external_url, drive_file_id,
            mime, size_bytes, duration_ms, status, position, created_by, created_at,
            source_name, share_url, drive_parent_id, local_state)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'none')`,
        videoId,
        ctx.workspace.id,
        projectId,
        item.title,
        item.source,
        null,
        item.externalUrl ?? null,
        item.driveFileId ?? null,
        item.mime ?? "video/mp4",
        item.sizeBytes ?? 0,
        item.durationMs ?? 0,
        "ready",
        startPosition + index,
        ctx.user.id,
        now(),
        item.sourceName ?? "",
        item.shareUrl ?? null,
        item.driveParentId ?? null,
      );
    });

    // The folder is the delivery. Only set it if the project has none yet, so
    // attaching a stray clip later cannot silently repoint the handoff.
    if (footageUrl) {
      run(
        `UPDATE projects SET footage_url = COALESCE(NULLIF(footage_url, ''), ?), updated_at = ?
          WHERE id = ? AND workspace_id = ?`,
        footageUrl,
        now(),
        projectId,
        ctx.workspace.id,
      );
    } else {
      run(
        "UPDATE projects SET updated_at = ? WHERE id = ? AND workspace_id = ?",
        now(),
        projectId,
        ctx.workspace.id,
      );
    }
  });

  const videos = many<Video>(
    `SELECT * FROM videos WHERE workspace_id = ? AND id IN (${ids.map(() => "?").join(",")})
      ORDER BY position ASC`,
    ctx.workspace.id,
    ...ids,
  );

  for (const video of videos) {
    if (video.source === "drive") enqueueLocalize(ctx, video);
  }

  emit(
    ctx.workspace.id,
    { type: "video", projectId, payload: { attached: ids.length } },
    {
      actorId: ctx.user.id,
      verb: "video.added",
      summary:
        videos.length === 1
          ? `${videos[0].title} attached to ${project.name}`
          : `${videos.length} clips attached to ${project.name}`,
    },
  );

  return json({ videos, video: videos[0] ?? null });
});
