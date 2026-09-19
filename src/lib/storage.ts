import fs from "node:fs";
import path from "node:path";
import { storageRoot } from "./db";

/**
 * Media lives on disk under `data/storage/<workspaceId>/<kind>/<file>`.
 * Keys are workspace-prefixed so a stray key from another tenant resolves to a
 * path the caller's guard has already rejected.
 */
export function buildKey(
  workspaceId: string,
  kind: "video" | "audio",
  filename: string,
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const unique = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  return `${workspaceId}/${kind}/${unique}-${safe}`;
}

/** Resolve a storage key to an absolute path, refusing anything that escapes root. */
export function resolveKey(key: string): string {
  const root = storageRoot();
  const abs = path.resolve(root, key);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid storage key.");
  }
  return abs;
}

export async function writeStream(
  key: string,
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const abs = resolveKey(key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const handle = await fs.promises.open(abs, "w");
  let written = 0;
  try {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > maxBytes) {
        await reader.cancel();
        throw new Error(
          `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
        );
      }
      await handle.write(value);
    }
  } catch (err) {
    await handle.close();
    await fs.promises.rm(abs, { force: true });
    throw err;
  }
  await handle.close();
  return written;
}

export async function writeBuffer(key: string, data: Buffer): Promise<number> {
  const abs = resolveKey(key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, data);
  return data.byteLength;
}

export async function readBuffer(key: string): Promise<Buffer> {
  return fs.promises.readFile(resolveKey(key));
}

export async function removeKey(key: string) {
  await fs.promises.rm(resolveKey(key), { force: true });
}

/** Remove a whole prefix, so deleting a clip leaves no empty folders behind. */
export async function removeTree(prefix: string) {
  await fs.promises.rm(resolveKey(prefix), { recursive: true, force: true });
}

/**
 * Remove files in one folder whose names start with any of these prefixes,
 * keeping the named exceptions. Cached derivatives (packet stills) are named
 * after what they were made from, so this is how the stale ones are swept
 * without touching another project's cache.
 */
export async function removeByPrefix(
  folder: string,
  prefixes: string[],
  keep: Set<string> = new Set(),
) {
  if (prefixes.length === 0) return;

  let entries: string[];
  try {
    entries = await fs.promises.readdir(resolveKey(folder));
  } catch {
    return; // no cache folder yet
  }

  await Promise.all(
    entries
      .filter(
        (name) => !keep.has(name) && prefixes.some((prefix) => name.startsWith(prefix)),
      )
      .map((name) => removeKey(`${folder}/${name}`).catch(() => undefined)),
  );
}

export function statKey(key: string): fs.Stats | null {
  try {
    return fs.statSync(resolveKey(key));
  } catch {
    return null;
  }
}

export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB || 512);
  return (Number.isFinite(mb) && mb > 0 ? mb : 512) * 1024 * 1024;
}
