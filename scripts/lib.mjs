import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Shared plumbing for the CLI scripts.
 *
 * The migrations are imported straight from `src/lib/schema.ts` (Node 24
 * strips the types), so there is exactly one definition of the schema and the
 * scripts can never drift from the app.
 */

export function dataDir() {
  const root = process.cwd();
  const configured = readEnv().DATA_DIR || "./data";
  return path.isAbsolute(configured) ? configured : path.join(root, configured);
}

export function dbPath() {
  return path.join(dataDir(), "cutlist.db");
}

/** Minimal .env.local reader. The scripts run outside Next, which loads it for us. */
export function readEnv() {
  const out = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match) continue;
      const key = match[1];
      if (out[key] !== undefined && process.env[key] !== undefined) continue;
      out[key] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return out;
}

export async function openDb() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );

  const { MIGRATIONS } = await import("../src/lib/schema.ts");
  const applied = new Set(
    db.prepare("SELECT id FROM _migrations").all().map((r) => r.id),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec(migration.sql);
    db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(
      migration.id,
      Date.now(),
    );
  }
  return db;
}

/** Same format as src/lib/crypto.ts; the app must be able to verify these. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export const now = () => Date.now();
