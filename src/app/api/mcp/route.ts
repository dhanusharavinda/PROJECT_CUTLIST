import { NextResponse } from "next/server";
import { authenticateToken, type TokenPrincipal } from "@/lib/graph/tokens";
import { buildEditGraph, compactGraph, type EditGraph } from "@/lib/graph/build";
import { shotRecord } from "@/lib/analysis/intel";
import { listFrames } from "@/lib/analysis/store";
import { readBuffer } from "@/lib/storage";
import { getProject } from "@/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A read-only MCP server over streamable HTTP.
 *
 * An outside agent (ChatGPT with a connector, Astra, anything that speaks MCP)
 * presents a project token and gets tools that read that one project: brief,
 * template, media manifest, shots, frames, transcript, instructions,
 * recommendations, the whole graph, the current revision, what is unresolved.
 * Nothing here writes. Cutlist stays authoritative; the agent reads, then goes
 * and operates its editor, and the result comes back through a connector or a
 * version, never through this door.
 *
 * Reachability is the operator's job: this app runs on localhost until it is
 * deployed or tunnelled, and a connector needs an HTTPS URL. The README says how.
 */

const PROTOCOL = "2025-06-18";
const SERVER = { name: "cutlist", version: "1.0.0" };

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  { name: "get_project", description: "Name, status, niche, who holds the edit, template and revision numbers.", input: {} },
  { name: "get_brief", description: "The creator brief as readable label and value pairs, plus completeness.", input: {} },
  { name: "get_template", description: "The template this project was created from, at the pinned version.", input: {} },
  { name: "get_template_version", description: "The exact template payload the project was born from.", input: {} },
  { name: "get_media_manifest", description: "Every clip: provider, external id, real filename, link, duration, codec, size and analysis status.", input: {} },
  { name: "get_shot_analysis", description: "Every detected shot as a structured record: timing, movement, composition, subject visibility, hook score, notes.", input: { video_id: { type: "string", description: "Limit to one clip" } } },
  { name: "get_representative_frames", description: "Sampled frames as base64 JPEGs with their timestamps. At most 12 per call.", input: { video_id: { type: "string" }, limit: { type: "integer" } } },
  { name: "get_transcript", description: "What is said in the footage, with timestamps, per clip.", input: { video_id: { type: "string" } } },
  { name: "get_creator_instructions", description: "The cut list: every instruction the creator decided on, with status.", input: { status: { type: "string", description: "open, doing, done or skipped" } } },
  { name: "get_ai_recommendations", description: "What the AI proposed and what the creator decided about each.", input: { status: { type: "string" } } },
  { name: "get_edit_graph", description: "Everything at once, compacted: the full EditGraph.", input: {} },
  { name: "get_current_revision", description: "The latest version, its approval state and what changed.", input: {} },
  { name: "get_unresolved_items", description: "Open instructions, undecided suggestions, unanswered questions, missing links, conflicts.", input: {} },
] as const;

function toolList() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: tool.input,
      additionalProperties: false,
    },
  }));
}

async function runTool(principal: TokenPrincipal, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { ctx, projectId } = principal;
  const project = getProject(ctx, projectId);
  const graph: EditGraph = buildEditGraph(ctx, projectId);
  const videoId = typeof args.video_id === "string" ? args.video_id : null;
  const inProject = (id: string | null) => id === null || graph.media.some((m) => m.id === id);

  switch (name) {
    case "get_project":
      return {
        ...graph.project,
        template: graph.template ? { id: graph.template.id, name: graph.template.name, version: graph.template.version } : null,
        latest_version: graph.versions.at(-1)?.label ?? null,
        media_count: graph.media.length,
        reel_shots: graph.reel.shots,
        reel_total_ms: graph.reel.total_ms,
      };
    case "get_brief":
      return graph.brief;
    case "get_template":
      return graph.template ? { id: graph.template.id, name: graph.template.name, version: graph.template.version } : null;
    case "get_template_version":
      return graph.template?.payload ?? null;
    case "get_media_manifest":
      return graph.media.map(({ frames, ...rest }) => ({ ...rest, frame_count: frames.length }));
    case "get_shot_analysis":
      if (!inProject(videoId)) return { error: "That clip is not in this project." };
      return graph.shots.filter((s) => !videoId || s.video_id === videoId).map((s) => shotRecord(s, s.video_id));
    case "get_representative_frames": {
      if (!inProject(videoId)) return { error: "That clip is not in this project." };
      const limit = Math.min(12, Math.max(1, Number(args.limit) || 12));
      const clips = videoId ? [videoId] : graph.media.map((m) => m.id);
      const out: { video_id: string; idx: number; at_ms: number; mime: string; data: string }[] = [];
      for (const clip of clips) {
        for (const frame of listFrames(ctx, clip)) {
          if (out.length >= limit) break;
          try {
            out.push({
              video_id: clip,
              idx: frame.idx,
              at_ms: frame.at_ms,
              mime: "image/jpeg",
              data: (await readBuffer(frame.storage_key)).toString("base64"),
            });
          } catch {
            /* a missing still is skipped, not fatal */
          }
        }
        if (out.length >= limit) break;
      }
      return out;
    }
    case "get_transcript":
      if (!inProject(videoId)) return { error: "That clip is not in this project." };
      return graph.transcripts.filter((t) => !videoId || t.video_id === videoId);
    case "get_creator_instructions": {
      const status = typeof args.status === "string" ? args.status : null;
      return graph.instructions.filter((i) => !status || i.status === status);
    }
    case "get_ai_recommendations": {
      const status = typeof args.status === "string" ? args.status : null;
      return graph.recommendations.filter((r) => !status || r.status === status);
    }
    case "get_edit_graph":
      return compactGraph(graph);
    case "get_current_revision": {
      const latest = graph.versions.at(-1) ?? null;
      return latest
        ? { ...latest, project_status: project.status, owner_state: project.owner_state }
        : { version: null, owner_state: project.owner_state, note: "No version has been recorded yet." };
    }
    case "get_unresolved_items":
      return {
        ...graph.unresolved,
        open_instruction_items: graph.instructions.filter((i) => i.status === "open" || i.status === "doing").slice(0, 100),
        proposed_items: graph.recommendations.filter((r) => r.status === "proposed" || r.status === "needs_review").slice(0, 100),
        unanswered: graph.questions.filter((q) => !q.answered).slice(0, 50),
      };
    default:
      return null;
  }
}

function rpcError(id: RpcRequest["id"], code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Server card, so a connector can be configured by pointing at the URL. */
export async function GET() {
  return NextResponse.json({
    name: SERVER.name,
    version: SERVER.version,
    protocol: PROTOCOL,
    transport: "streamable-http",
    auth: "Authorization: Bearer <project token from Cutlist>",
    tools: TOOLS.map((t) => t.name),
    read_only: true,
  });
}

export async function POST(req: Request) {
  let payload: RpcRequest | RpcRequest[];
  try {
    payload = (await req.json()) as RpcRequest | RpcRequest[];
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (Array.isArray(payload)) return rpcError(null, -32600, "Batches are not supported.", 400);

  const { id, method, params } = payload;

  // Notifications carry no id and expect no body.
  if (method === "notifications/initialized" || (method ?? "").startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "Read-only view of one Cutlist project. Read the brief, the shots and the instructions before proposing or executing anything, and respect every rule in get_brief. Cutlist owns the creative state; send results back through the app, not through this server.",
      },
    });
  }

  if (method === "ping") return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result: {} });

  const principal = authenticateToken(bearerFrom(req));
  if (!principal) return rpcError(id, -32001, "A valid project token is required.", 401);

  if (method === "tools/list") {
    return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result: { tools: toolList() } });
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = (params?.arguments as Record<string, unknown> | undefined) ?? {};
    if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
    try {
      const result = await runTool(principal, name, args);
      return NextResponse.json({
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result && typeof result === "object" && !Array.isArray(result) ? result : { items: result },
          isError: false,
        },
      });
    } catch (err) {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: id ?? null,
        result: { content: [{ type: "text", text: (err as Error).message }], isError: true },
      });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}
