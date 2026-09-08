import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { assert, badRequest, can, requireCtx } from "@/lib/tenancy";
import {
  allSettings,
  deleteSecret,
  listSecretHints,
  SECRET_KEYS,
  setSecret,
  setSetting,
  SETTING_KEYS,
  type SecretKey,
  type SettingKey,
} from "@/lib/ai/keys";
import { resolveStt, STT_PROVIDERS } from "@/lib/ai/stt";
import { resolveLlm, LLM_PROVIDERS } from "@/lib/ai/llm";
import { driveConfigured, getConnection } from "@/lib/drive";
import { logActivity } from "@/lib/activity";

export const GET = route(async () => {
  const ctx = await requireCtx();
  assert(can.manageSecrets(ctx.role), "Only owners and creators can view AI settings.");

  const stt = resolveStt(ctx.workspace.id);
  const llm = resolveLlm(ctx.workspace.id);
  const drive = getConnection(ctx.workspace.id);

  return json({
    workspace: { id: ctx.workspace.id, name: ctx.workspace.name, slug: ctx.workspace.slug },
    role: ctx.role,
    secrets: listSecretHints(ctx.workspace.id),
    settings: allSettings(ctx.workspace.id),
    providers: {
      stt: STT_PROVIDERS.map((p) => ({ ...p })),
      llm: LLM_PROVIDERS.map((p) => ({ ...p })),
    },
    active: {
      stt: stt ? { provider: stt.provider.id, model: stt.model } : null,
      llm: llm ? { provider: llm.provider.id, model: llm.model } : null,
    },
    drive: {
      available: driveConfigured(),
      connected: Boolean(drive),
      accountEmail: drive?.account_email ?? null,
      connectedAt: drive?.created_at ?? null,
    },
  });
});

const Update = z.object({
  secrets: z.record(z.string(), z.string()).optional(),
  removeSecrets: z.array(z.string()).optional(),
  settings: z.record(z.string(), z.string()).optional(),
});

export const PUT = route(async (req) => {
  const ctx = await requireCtx();
  assert(can.manageSecrets(ctx.role), "Only owners and creators can change AI settings.");

  const input = Update.parse(await body(req));
  const touched: string[] = [];

  for (const [key, value] of Object.entries(input.secrets ?? {})) {
    if (!(SECRET_KEYS as readonly string[]).includes(key))
      throw badRequest(`Unknown credential "${key}".`);
    if (!value.trim()) continue;
    setSecret(ctx.workspace.id, key as SecretKey, value, ctx.user.id);
    touched.push(key);
  }

  for (const key of input.removeSecrets ?? []) {
    if (!(SECRET_KEYS as readonly string[]).includes(key))
      throw badRequest(`Unknown credential "${key}".`);
    deleteSecret(ctx.workspace.id, key as SecretKey);
    touched.push(`-${key}`);
  }

  for (const [key, value] of Object.entries(input.settings ?? {})) {
    if (!(SETTING_KEYS as readonly string[]).includes(key))
      throw badRequest(`Unknown setting "${key}".`);
    setSetting(ctx.workspace.id, key as SettingKey, value);
  }

  if (touched.length) {
    // Names only — a key's value must never reach the activity log.
    logActivity({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      verb: "settings.keys",
      summary: `AI credentials updated (${touched.join(", ")})`,
    });
  }

  const stt = resolveStt(ctx.workspace.id);
  const llm = resolveLlm(ctx.workspace.id);

  return json({
    ok: true,
    secrets: listSecretHints(ctx.workspace.id),
    settings: allSettings(ctx.workspace.id),
    active: {
      stt: stt ? { provider: stt.provider.id, model: stt.model } : null,
      llm: llm ? { provider: llm.provider.id, model: llm.model } : null,
    },
  });
});
