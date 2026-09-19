import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, badRequest, can, getProject, requireCtx } from "@/lib/tenancy";
import { logActivity } from "@/lib/activity";
import { createToken, listTokens, revokeToken } from "@/lib/graph/tokens";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  assert(can.manageSecrets(ctx.role), "Only owners and creators see access tokens.");
  return json({ tokens: listTokens(ctx, projectId) });
});

const Create = z.object({ name: z.string().trim().min(1).max(80) });

/** Issue a read-only token for an outside agent. The plaintext is returned once. */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);
  assert(can.manageSecrets(ctx.role), "Only owners and creators issue access tokens.");

  const { name } = Create.parse(await body(req));
  const { token, row } = createToken(ctx, projectId, name);

  logActivity({
    workspaceId: ctx.workspace.id,
    projectId,
    actorId: ctx.user.id,
    verb: "token.created",
    summary: `Read-only access token "${row.name}" issued for ${project.name}`,
  });

  const origin = process.env.APP_URL || "http://localhost:3000";
  return json({
    token,
    row,
    mcp: { url: `${origin}/api/mcp`, transport: "streamable-http", header: "Authorization: Bearer <token>" },
  });
});

export const DELETE = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  getProject(ctx, projectId);
  assert(can.manageSecrets(ctx.role), "Only owners and creators revoke access tokens.");

  const tokenId = new URL(req.url).searchParams.get("id");
  if (!tokenId) throw badRequest("Which token?");
  const revoked = revokeToken(ctx, projectId, tokenId);
  if (revoked) {
    logActivity({
      workspaceId: ctx.workspace.id,
      projectId,
      actorId: ctx.user.id,
      verb: "token.revoked",
      summary: "A read-only access token was revoked",
    });
  }
  return json({ revoked });
});
