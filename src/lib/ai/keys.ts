import { many, now, one, run } from "../db";
import { decryptSecret, encryptSecret, keyHint } from "../crypto";

/**
 * Credentials are workspace-scoped first, environment second.
 *
 * The product intent is that a creator pastes their own key into
 * Settings → AI providers; the env vars only exist so a developer can run the
 * app without touching the UI. A workspace can never read another workspace's
 * key: the row is keyed by (workspace_id, key) and always fetched with both.
 */

export const SECRET_KEYS = [
  "OPENAI_API_KEY",
  "DEEPGRAM_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

export const SETTING_KEYS = [
  "STT_PROVIDER",
  "STT_MODEL",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_MODEL_FAST",
  "LLM_MODEL_DEEP",
  "SOLO_MODE",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export function getSecret(
  workspaceId: string,
  key: SecretKey,
): { value: string; source: "workspace" | "env" } | null {
  const row = one<{ value_enc: string }>(
    "SELECT value_enc FROM workspace_secrets WHERE workspace_id = ? AND key = ?",
    workspaceId,
    key,
  );
  if (row) {
    const value = decryptSecret(row.value_enc);
    if (value) return { value, source: "workspace" };
  }
  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.trim()) return { value: fromEnv.trim(), source: "env" };
  return null;
}

export function setSecret(
  workspaceId: string,
  key: SecretKey,
  value: string,
  userId: string,
) {
  run(
    `INSERT INTO workspace_secrets (workspace_id, key, value_enc, hint, updated_by, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (workspace_id, key) DO UPDATE SET
       value_enc = excluded.value_enc,
       hint = excluded.hint,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    workspaceId,
    key,
    encryptSecret(value.trim()),
    keyHint(value),
    userId,
    now(),
  );
}

export function deleteSecret(workspaceId: string, key: SecretKey) {
  run(
    "DELETE FROM workspace_secrets WHERE workspace_id = ? AND key = ?",
    workspaceId,
    key,
  );
}

/** Hints only; the plaintext never leaves the server. */
export function listSecretHints(workspaceId: string) {
  const rows = many<{ key: string; hint: string; updated_at: number }>(
    "SELECT key, hint, updated_at FROM workspace_secrets WHERE workspace_id = ?",
    workspaceId,
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SECRET_KEYS.map((key) => {
    const stored = byKey.get(key);
    const env = process.env[key]?.trim();
    return {
      key,
      configured: Boolean(stored || env),
      source: stored ? ("workspace" as const) : env ? ("env" as const) : null,
      hint: stored?.hint ?? (env ? keyHint(env) : ""),
      updatedAt: stored?.updated_at ?? null,
    };
  });
}

export function getSetting(
  workspaceId: string,
  key: SettingKey,
  fallback = "",
): string {
  const row = one<{ value: string }>(
    "SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?",
    workspaceId,
    key,
  );
  if (row?.value) return row.value;
  const env = process.env[key];
  if (env && env.trim()) return env.trim();
  return fallback;
}

export function setSetting(workspaceId: string, key: SettingKey, value: string) {
  run(
    `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?,?,?)
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
    workspaceId,
    key,
    value,
  );
}

export function allSettings(workspaceId: string): Record<string, string> {
  const rows = many<{ key: string; value: string }>(
    "SELECT key, value FROM workspace_settings WHERE workspace_id = ?",
    workspaceId,
  );
  const out: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    const stored = rows.find((r) => r.key === key);
    out[key] = stored?.value ?? process.env[key] ?? "";
  }
  return out;
}
