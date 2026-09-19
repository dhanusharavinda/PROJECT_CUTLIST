import { buildKey, statKey, writeStream } from "../storage";
import type { Ctx } from "../tenancy";
import type { Video } from "../types";
import { driveConfigured, getConnection, getFile, streamFile } from "../drive";

/**
 * Where footage lives, behind one interface.
 *
 * Google Drive was the first home and it stays the recommended one, but it is
 * one connector among several, not the architecture. Cutlist stores a provider
 * and an external id per clip, and everything that needs bytes asks the
 * provider. Adding Dropbox, OneDrive or S3 is a new entry in the registry, not
 * a change to the reel, the packet or the analyser.
 */

export type MediaProviderId = "local" | "google_drive" | "link";

export type MediaCapability =
  | "list"
  | "fetch"
  | "stream"
  | "range"
  | "thumbnail"
  | "link";

export interface MediaRef {
  provider: MediaProviderId;
  external_id: string | null;
  name: string;
  size: number;
  duration_ms: number;
  checksum: string | null;
  status: "available" | "missing" | "unknown";
  /** A link a person can open, when the provider has one. */
  url: string | null;
}

export interface FetchResult {
  key: string;
  size: number;
  name: string;
}

export interface MediaProvider {
  id: MediaProviderId;
  label: string;
  capabilities: MediaCapability[];
  /** Whether this instance can use the provider at all. */
  configured(): boolean;
  /** What the provider knows about the clip, without moving bytes. */
  describe(ctx: Ctx, video: Video): Promise<MediaRef>;
  /** Bytes for the player, honouring a Range header where the provider can. */
  openStream?(ctx: Ctx, video: Video, range: string | null): Promise<Response>;
  /** Bring the original onto this machine as a working copy. */
  fetchToLocal?(
    ctx: Ctx,
    video: Video,
    options: { maxBytes: number; onBytes?: (copied: number, total: number) => void },
  ): Promise<FetchResult>;
}

export class NotSupportedByProvider extends Error {
  constructor(provider: string, capability: MediaCapability) {
    super(`${provider} cannot ${capability} on this instance.`);
    this.name = "NotSupportedByProvider";
  }
}

function counted(
  stream: ReadableStream<Uint8Array>,
  total: number,
  onBytes?: (copied: number, total: number) => void,
): ReadableStream<Uint8Array> {
  let copied = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        copied += chunk.byteLength;
        onBytes?.(copied, total);
        controller.enqueue(chunk);
      },
    }),
  );
}

const local: MediaProvider = {
  id: "local",
  label: "This machine",
  capabilities: ["stream", "range"],
  configured: () => true,
  async describe(_ctx, video) {
    const stat = video.storage_key ? statKey(video.storage_key) : null;
    return {
      provider: "local",
      external_id: video.storage_key,
      name: video.source_name || video.title,
      size: stat?.size ?? video.size_bytes,
      duration_ms: video.duration_ms,
      checksum: null,
      status: stat ? "available" : "missing",
      url: null,
    };
  },
};

const googleDrive: MediaProvider = {
  id: "google_drive",
  label: "Google Drive",
  capabilities: ["list", "fetch", "stream", "range", "thumbnail", "link"],
  configured: () => driveConfigured(),
  async describe(ctx, video) {
    if (!video.drive_file_id || !getConnection(ctx.workspace.id)) {
      return {
        provider: "google_drive",
        external_id: video.drive_file_id,
        name: video.source_name || video.title,
        size: video.size_bytes,
        duration_ms: video.duration_ms,
        checksum: null,
        status: "unknown",
        url: video.share_url,
      };
    }
    try {
      const file = await getFile(ctx.workspace.id, video.drive_file_id);
      return {
        provider: "google_drive",
        external_id: file.id,
        name: file.name,
        size: file.size,
        duration_ms: file.durationMs || video.duration_ms,
        checksum: null,
        status: "available",
        url: file.webViewLink ?? video.share_url,
      };
    } catch {
      return {
        provider: "google_drive",
        external_id: video.drive_file_id,
        name: video.source_name || video.title,
        size: video.size_bytes,
        duration_ms: video.duration_ms,
        checksum: null,
        status: "missing",
        url: video.share_url,
      };
    }
  },
  async openStream(ctx, video, range) {
    if (!video.drive_file_id) throw new NotSupportedByProvider("Google Drive", "stream");
    return streamFile(ctx.workspace.id, video.drive_file_id, range);
  },
  async fetchToLocal(ctx, video, options) {
    if (!video.drive_file_id) throw new NotSupportedByProvider("Google Drive", "fetch");

    // Size first: writeStream throws away a partial copy that trips the cap,
    // and a phone clip can be gigabytes.
    const meta = await getFile(ctx.workspace.id, video.drive_file_id);
    if (meta.size > options.maxBytes) {
      throw new Error(
        `That clip is ${Math.round(meta.size / 1024 / 1024)} MB and the limit is ${Math.round(options.maxBytes / 1024 / 1024)} MB. Raise IMPORT_MAX_MB in .env.local to bring it in.`,
      );
    }

    const upstream = await streamFile(ctx.workspace.id, video.drive_file_id);
    if (!upstream.body) throw new Error("Drive returned no data for that clip.");

    const key = buildKey(ctx.workspace.id, "video", meta.name || `${video.title}.mp4`);
    const size = await writeStream(key, counted(upstream.body, meta.size, options.onBytes), options.maxBytes);
    return { key, size, name: meta.name ?? "" };
  },
};

const link: MediaProvider = {
  id: "link",
  label: "Direct link",
  capabilities: ["stream", "link"],
  configured: () => true,
  async describe(_ctx, video) {
    return {
      provider: "link",
      external_id: video.external_url,
      name: video.source_name || video.title,
      size: video.size_bytes,
      duration_ms: video.duration_ms,
      checksum: null,
      status: video.external_url ? "unknown" : "missing",
      url: video.external_url,
    };
  },
  async openStream(_ctx, video) {
    if (!video.external_url) throw new NotSupportedByProvider("Direct link", "stream");
    return Response.redirect(video.external_url, 302);
  },
};

const REGISTRY: Record<MediaProviderId, MediaProvider> = {
  local,
  google_drive: googleDrive,
  link,
};

/** The provider that holds a clip's original. A local copy is a cache, not a home. */
export function providerIdFor(video: Pick<Video, "source">): MediaProviderId {
  if (video.source === "drive") return "google_drive";
  if (video.source === "link") return "link";
  return "local";
}

export function providerFor(video: Pick<Video, "source">): MediaProvider {
  return REGISTRY[providerIdFor(video)];
}

export function mediaProvider(id: string): MediaProvider | null {
  return (REGISTRY as Record<string, MediaProvider>)[id] ?? null;
}

/** Capability discovery, for Settings and for an outside agent. */
export function listMediaProviders() {
  return Object.values(REGISTRY).map((p) => ({
    provider: p.id,
    label: p.label,
    capabilities: p.capabilities,
    configured: p.configured(),
  }));
}
