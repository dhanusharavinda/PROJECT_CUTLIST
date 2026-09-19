import type { Ctx } from "../tenancy";
import { buildEditGraph, compactGraph } from "../graph/build";
import { createProjectVersion, type VersionKind } from "../graph/versions";
import { actorFor } from "../graph/events";
import { reelView } from "../reel/store";

/**
 * Where the edit gets executed, behind one interface.
 *
 * Cutlist never edits video. Something else does: a human in Premiere or
 * CapCut, an agent driving one of those, a generation service. Each of them is
 * a connector that declares what it can do, and the app degrades to what is
 * declared instead of pretending. Today the one real connector is the file
 * handoff (packet, EDL, markdown, the AI package) plus a sync-in path that a
 * future plugin posts the same shape to. The NLE entries exist so the
 * capability map is honest about what is not wired yet.
 */

export type ConnectorCapability =
  | "timeline"
  | "markers"
  | "cuts"
  | "speed"
  | "captions"
  | "transitions"
  | "assets"
  | "preview"
  | "sync_in"
  | "sequence_export"
  | "package";

export type ConnectorKind = "file" | "nle" | "generator";

export interface ConnectorContext {
  ctx: Ctx;
  projectId: string;
}

export interface ExportedFile {
  /** A URL inside this app that produces the file, so the browser downloads it. */
  href: string;
  filename_hint: string;
  mime: string;
}

export interface SyncPayload {
  kind?: VersionKind;
  summary?: string;
  video_id?: string | null;
  completed?: string[];
  unresolved?: string[];
  changes?: string[];
  /** The timeline as the tool knows it, when it can tell us. */
  slots?: { video_id: string; in_ms: number; out_ms: number }[];
}

export interface EditorConnector {
  id: string;
  label: string;
  kind: ConnectorKind;
  capabilities: ConnectorCapability[];
  configured(): boolean;
  /** What this connector believes the project looks like. */
  getProjectState?(c: ConnectorContext): Promise<unknown>;
  exportProject?(c: ConnectorContext, format: string): Promise<ExportedFile>;
  /** Something came back from the tool: record it as a version. */
  syncState?(c: ConnectorContext, payload: SyncPayload): Promise<{ version_id: string; label: string }>;
  // The mutating operations below are declared for discovery. A connector that
  // cannot do one simply does not implement it, and the API answers 501.
  importAssets?(c: ConnectorContext): Promise<unknown>;
  applyEditPlan?(c: ConnectorContext): Promise<unknown>;
  createMarker?(c: ConnectorContext, input: unknown): Promise<unknown>;
  createSequence?(c: ConnectorContext): Promise<unknown>;
  createCaption?(c: ConnectorContext, input: unknown): Promise<unknown>;
  applySpeedChange?(c: ConnectorContext, input: unknown): Promise<unknown>;
  applyTransition?(c: ConnectorContext, input: unknown): Promise<unknown>;
  exportPreview?(c: ConnectorContext): Promise<unknown>;
}

export class NotSupportedByConnector extends Error {
  constructor(
    public connector: string,
    public operation: string,
    public capabilities: ConnectorCapability[],
  ) {
    super(`${connector} does not support ${operation}.`);
    this.name = "NotSupportedByConnector";
  }
}

const EXPORT_FORMATS: Record<string, { mime: string; ext: string }> = {
  packet: { mime: "text/html", ext: "html" },
  edl: { mime: "text/plain", ext: "edl" },
  md: { mime: "text/markdown", ext: "md" },
  csv: { mime: "text/csv", ext: "csv" },
  json: { mime: "application/json", ext: "json" },
  package: { mime: "application/json", ext: "json" },
};

/** The handoff as files: what every editor and every agent can take today. */
const fileHandoff: EditorConnector = {
  id: "file_handoff",
  label: "File handoff (packet, EDL, AI package)",
  kind: "file",
  capabilities: ["markers", "sequence_export", "package", "sync_in"],
  configured: () => true,
  async getProjectState({ ctx, projectId }) {
    return compactGraph(buildEditGraph(ctx, projectId));
  },
  async exportProject({ projectId }, format) {
    const known = EXPORT_FORMATS[format];
    if (!known) throw new NotSupportedByConnector("File handoff", `export as ${format}`, fileHandoff.capabilities);
    return {
      href: `/api/projects/${projectId}/export?format=${encodeURIComponent(format)}`,
      filename_hint: `${format}.${known.ext}`,
      mime: known.mime,
    };
  },
  async syncState({ ctx, projectId }, payload) {
    const kind = payload.kind ?? "human_edit";
    const actorKind = kind === "ai_draft" || kind === "ai_revision" ? "ai" : actorFor(ctx.role);
    const reel = reelView(ctx, projectId);
    const version = createProjectVersion(ctx, projectId, {
      kind,
      summary: payload.summary ?? "Synced from a file handoff",
      actorKind,
      actorId: actorKind === "ai" ? ctx.user.id : undefined,
      videoId: payload.video_id ?? null,
      payload: {
        slots:
          payload.slots ??
          reel.slots.map((s) => ({ video_id: s.video_id, in_ms: s.in_ms, out_ms: s.out_ms })),
        total_ms: payload.slots
          ? payload.slots.reduce((t, s) => t + Math.max(0, s.out_ms - s.in_ms), 0)
          : reel.total_ms,
        completed: payload.completed ?? [],
        unresolved: payload.unresolved ?? [],
        changes: payload.changes ?? [],
      },
    });
    return { version_id: version.id, label: version.label };
  },
};

/** Declared, not wired: honest placeholders so discovery tells the truth. */
function unwired(id: string, label: string, kind: ConnectorKind, capabilities: ConnectorCapability[]): EditorConnector {
  return {
    id,
    label,
    kind,
    capabilities,
    configured: () => false,
    async getProjectState() {
      throw new NotSupportedByConnector(label, "project state", capabilities);
    },
  };
}

const REGISTRY: EditorConnector[] = [
  fileHandoff,
  unwired("capcut", "CapCut (via an agent)", "nle", ["timeline", "cuts", "speed", "captions", "transitions"]),
  unwired("premiere", "Adobe Premiere Pro", "nle", ["timeline", "markers", "cuts", "speed", "captions", "transitions", "assets", "preview", "sync_in"]),
  unwired("resolve", "DaVinci Resolve", "nle", ["timeline", "markers", "cuts", "speed", "captions", "transitions", "assets", "preview", "sync_in"]),
  unwired("finalcut", "Final Cut Pro", "nle", ["timeline", "markers", "cuts", "captions", "sequence_export"]),
  unwired("higgsfield", "Higgsfield (generation)", "generator", ["assets", "preview"]),
];

export function listConnectors() {
  return REGISTRY.map((c) => ({
    provider: c.id,
    label: c.label,
    kind: c.kind,
    capabilities: c.capabilities,
    configured: c.configured(),
  }));
}

export function connector(id: string): EditorConnector | null {
  return REGISTRY.find((c) => c.id === id) ?? null;
}
