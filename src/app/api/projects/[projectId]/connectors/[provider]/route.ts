import { z } from "zod";
import { NextResponse } from "next/server";
import { body, json, route } from "@/lib/api";
import { assert, badRequest, can, getProject, notFound, requireCtx } from "@/lib/tenancy";
import { emit } from "@/lib/activity";
import { connector, NotSupportedByConnector } from "@/lib/connectors";
import { VERSION_KINDS } from "@/lib/graph/versions";

type Params = { params: Promise<{ projectId: string; provider: string }> };

export const dynamic = "force-dynamic";

function degrade(err: unknown) {
  if (err instanceof NotSupportedByConnector) {
    return NextResponse.json(
      { error: err.message, connector: err.connector, capabilities: err.capabilities },
      { status: 501 },
    );
  }
  throw err;
}

/** What the connector knows about the project. */
export const GET = route(async (_req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId, provider } = await params;
  getProject(ctx, projectId);
  const target = connector(provider);
  if (!target) throw notFound("No such connector.");
  if (!target.getProjectState) {
    return degrade(new NotSupportedByConnector(target.label, "project state", target.capabilities));
  }
  try {
    return json({ provider: target.id, state: await target.getProjectState({ ctx, projectId }) });
  } catch (err) {
    return degrade(err);
  }
});

const Operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("export"), format: z.string().trim().min(1).max(20) }),
  z.object({
    op: z.literal("sync"),
    kind: z.enum(VERSION_KINDS).optional(),
    summary: z.string().trim().max(2000).optional(),
    video_id: z.string().trim().min(1).nullable().optional(),
    completed: z.array(z.string()).max(400).optional(),
    unresolved: z.array(z.string()).max(400).optional(),
    changes: z.array(z.string().trim().max(300)).max(60).optional(),
    slots: z
      .array(z.object({ video_id: z.string(), in_ms: z.number().int().nonnegative(), out_ms: z.number().int().nonnegative() }))
      .max(60)
      .optional(),
  }),
  z.object({ op: z.enum(["import_assets", "apply_edit_plan", "create_sequence", "export_preview"]) }),
]);

/**
 * Ask a connector to do something. Unsupported operations answer 501 with the
 * capability list, so a caller can adapt instead of guessing.
 */
export const POST = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId, provider } = await params;
  const project = getProject(ctx, projectId);
  assert(can.createLabel(ctx.role), "Viewers cannot drive a connector.");

  const target = connector(provider);
  if (!target) throw notFound("No such connector.");
  const input = Operation.parse(await body(req));
  const c = { ctx, projectId };

  try {
    switch (input.op) {
      case "export": {
        if (!target.exportProject) throw new NotSupportedByConnector(target.label, "export", target.capabilities);
        return json({ file: await target.exportProject(c, input.format) });
      }
      case "sync": {
        if (!target.syncState) throw new NotSupportedByConnector(target.label, "sync", target.capabilities);
        const result = await target.syncState(c, input);
        emit(
          ctx.workspace.id,
          { type: "graph", projectId, payload: { version: result.version_id } },
          { actorId: ctx.user.id, verb: "connector.synced", summary: `${result.label} synced from ${target.label} on ${project.name}` },
        );
        return json(result);
      }
      case "import_assets":
        if (!target.importAssets) throw new NotSupportedByConnector(target.label, "import assets", target.capabilities);
        return json({ result: await target.importAssets(c) });
      case "apply_edit_plan":
        if (!target.applyEditPlan) throw new NotSupportedByConnector(target.label, "apply edit plan", target.capabilities);
        return json({ result: await target.applyEditPlan(c) });
      case "create_sequence":
        if (!target.createSequence) throw new NotSupportedByConnector(target.label, "create sequence", target.capabilities);
        return json({ result: await target.createSequence(c) });
      case "export_preview":
        if (!target.exportPreview) throw new NotSupportedByConnector(target.label, "export preview", target.capabilities);
        return json({ result: await target.exportPreview(c) });
      default:
        throw badRequest("Unknown operation.");
    }
  } catch (err) {
    return degrade(err);
  }
});
