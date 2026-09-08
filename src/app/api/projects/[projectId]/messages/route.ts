import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { id, now, one, run } from "@/lib/db";
import { assert, badRequest, can, getLabel, getProject, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { listMessages } from "@/lib/queries";

type Params = { params: Promise<{ projectId: string }> };

export const GET = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);

  const limit = Math.min(
    500,
    Math.max(1, Number(new URL(req.url).searchParams.get("limit") || 200)),
  );
  return json({ messages: listMessages(ctx, projectId, limit) });
});

const Send = z.object({
  body: z.string().trim().min(1, "Say something.").max(4000),
  meta: z
    .object({
      videoId: z.string().optional(),
      atMs: z.number().int().nonnegative().optional(),
      labelId: z.string().optional(),
    })
    .optional(),
});

export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  assert(can.chat(ctx.role), "Viewers cannot post in the project room.");

  const input = Send.parse(await body(req));

  // A message can be pinned to one instruction — that is how a question about
  // "the punch-in at 1:41" stays attached to the punch-in instead of scrolling
  // away in the room. The label has to be real, and in this project.
  if (input.meta?.labelId) {
    const label = getLabel(ctx, input.meta.labelId);
    if (label.project_id !== projectId)
      throw badRequest("That instruction belongs to a different project.");
  }

  const messageId = id("msg");
  run(
    "INSERT INTO messages (id, workspace_id, project_id, author_id, kind, body, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
    messageId,
    ctx.workspace.id,
    projectId,
    ctx.user.id,
    "text",
    input.body,
    input.meta ? JSON.stringify(input.meta) : null,
    now(),
  );

  const message = one(
    `SELECT m.*, u.name AS author_name
       FROM messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.id = ? AND m.workspace_id = ?`,
    messageId,
    ctx.workspace.id,
  );

  emit(ctx.workspace.id, { type: "message", projectId, payload: message });

  return json({ message });
});
