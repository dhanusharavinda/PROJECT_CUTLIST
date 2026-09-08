import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";

export type SqlValue = string | number | bigint | null | Uint8Array;
type Bindable = SqlValue | boolean | undefined | Date;

/**
 * node:sqlite only accepts null | number | bigint | string | Uint8Array.
 * Booleans, `undefined` and Dates are common enough in app code that silently
 * normalising them here is worth more than the strictness.
 */
function bind(values: Bindable[]): SqlValue[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v instanceof Date) return v.getTime();
    return v;
  });
}

function dataDir(): string {
  const configured = process.env.DATA_DIR || "./data";
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

export function storageRoot(): string {
  const dir = path.join(dataDir(), "storage");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function open(): DatabaseSync {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "cutlist.db");

  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: string }[]).map(
      (r) => r.id,
    ),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.id} failed: ${(err as Error).message}`,
      );
    }
  }

  return db;
}

/**
 * Opened on first query, not on import.
 *
 * `next build` imports every route module in several worker processes to
 * collect page data. Connecting eagerly meant each worker raced to run the
 * migrations and they deadlocked on the WAL. Nothing in a module body needs the
 * database, so deferring the connection removes the race entirely.
 *
 * The handle is also cached on globalThis because Next re-evaluates modules on
 * hot reload, and a second handle per process would reintroduce the same lock.
 */
const globalForDb = globalThis as unknown as { __cutlistDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  const existing = globalForDb.__cutlistDb;
  if (existing) return existing;
  const opened = open();
  globalForDb.__cutlistDb = opened;
  return opened;
}

/**
 * node:sqlite hands back objects with a null prototype. React refuses to
 * serialise those across the server/client boundary ("Classes or null
 * prototypes are not supported"), so every row is re-shaped into a plain
 * object on the way out. Doing it here means no caller has to remember.
 */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

/** Fetch a single row, or null. */
export function one<T>(sql: string, ...params: Bindable[]): T | null {
  const row = getDb().prepare(sql).get(...bind(params));
  return row === undefined || row === null ? null : plain<T>(row);
}

/** Fetch all matching rows. */
export function many<T>(sql: string, ...params: Bindable[]): T[] {
  return getDb()
    .prepare(sql)
    .all(...bind(params))
    .map((row) => plain<T>(row));
}

/** Execute a write. */
export function run(sql: string, ...params: Bindable[]) {
  return getDb().prepare(sql).run(...bind(params));
}

/** Run `fn` inside a transaction, rolling back on throw. */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function now(): number {
  return Date.now();
}
