import { getProject, HttpError, requireCtx } from "@/lib/tenancy";
import { bus, dropPresence, listPresence, touchPresence } from "@/lib/bus";

type Params = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A signed-out tab keeps its EventSource retrying, so an expired session here
 * is routine, not exceptional. Answer with a plain status instead of letting an
 * HttpError bubble into the server log as a stack trace.
 */
function refuse(err: unknown): Response {
  if (err instanceof HttpError)
    return new Response(err.message, { status: err.status });
  throw err;
}

/**
 * Server-sent events for the shared project room.
 *
 * The subscription is opened on `workspace.id + project.id` *after* the
 * membership check, so a client can only ever be attached to a channel it has
 * already been authorised for. Chat, notes, labels, brief edits and presence
 * all ride this one connection.
 */
export async function GET(req: Request, { params }: Params) {
  let ctx: Awaited<ReturnType<typeof requireCtx>>;
  let projectId: string;
  try {
    ctx = await requireCtx();
    projectId = (await params).projectId;
    getProject(ctx, projectId);
  } catch (err) {
    return refuse(err);
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const announcePresence = () => {
        touchPresence(ctx.workspace.id, projectId, ctx.user.id, ctx.user.name);
        bus.publish(ctx.workspace.id, {
          type: "presence",
          projectId,
          payload: listPresence(ctx.workspace.id, projectId),
        });
      };

      send("ready", {
        projectId,
        you: { id: ctx.user.id, name: ctx.user.name, role: ctx.role },
      });
      announcePresence();

      unsubscribe = bus.subscribe(ctx.workspace.id, projectId, (event) => {
        send(event.type, event.payload);
      });

      // Keeps proxies from closing an idle connection, and refreshes presence.
      heartbeat = setInterval(() => {
        if (closed) return;
        announcePresence();
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 20_000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      dropPresence(ctx.workspace.id, projectId, ctx.user.id);
      bus.publish(ctx.workspace.id, {
        type: "presence",
        projectId,
        payload: listPresence(ctx.workspace.id, projectId),
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
