import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, can, requireCtx } from "@/lib/tenancy";
import { addVersion, listVersions } from "@/lib/templates/store";

type Params = { params: Promise<{ templateId: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { templateId } = await params;
  return json({
    versions: listVersions(ctx, templateId).map((v) => {
      let payload: unknown = {};
      try {
        payload = JSON.parse(v.payload);
      } catch {
        payload = {};
      }
      return { id: v.id, version: v.version, summary: v.summary, created_at: v.created_at, payload };
    }),
  });
});

const Save = z.object({
  payload: z.unknown(),
  summary: z.string().trim().max(200).optional(),
});

/**
 * Editing a template is always a new version. The old one stays, and so does
 * every project that was created from it.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { templateId } = await params;
  assert(can.editBrief(ctx.role), "Only owners and creators can change templates.");

  const input = Save.parse(await body(req));
  const template = addVersion(ctx, templateId, input.payload, input.summary ?? "");
  return json({ template });
});
