import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, can, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { getProjectVersion, setApproval } from "@/lib/graph/versions";

type Params = { params: Promise<{ versionId: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { versionId } = await params;
  return json({ version: getProjectVersion(ctx, versionId) });
});

const Patch = z.object({
  approval: z.enum(["pending", "approved", "changes_requested"]),
  note: z.string().trim().max(1000).optional(),
});

/** The creator's verdict on a version. */
export const PATCH = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { versionId } = await params;
  assert(can.editBrief(ctx.role), "Only owners and creators approve a version.");

  const input = Patch.parse(await body(req));
  const version = setApproval(ctx, versionId, input.approval, input.note ?? "");

  emit(ctx.workspace.id, {
    type: "graph",
    projectId: version.project_id,
    payload: { version: version.id, approval: version.approval },
  });

  return json({ version });
});
