import Anthropic from "@anthropic-ai/sdk";
import { getSecret, getSetting, type SecretKey } from "./keys";

/**
 * One `complete()` call, five possible backends.
 *
 * Anthropic goes through the official SDK. The remaining providers are reached
 * over their own HTTP APIs; three of them share OpenAI's chat-completions
 * shape, so they collapse into a single code path.
 */

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
}

export class LlmUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailable";
  }
}

export const LLM_PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    secret: "ANTHROPIC_API_KEY" as SecretKey,
    defaultModel: "claude-opus-5",
    note: "Best reasoning over long, rambling voice notes. Recommended.",
  },
  {
    id: "openai",
    label: "OpenAI",
    secret: "OPENAI_API_KEY" as SecretKey,
    defaultModel: "gpt-4o-mini",
    note: "Same key also powers Whisper transcription.",
  },
  {
    id: "google",
    label: "Google Gemini",
    secret: "GOOGLE_AI_API_KEY" as SecretKey,
    defaultModel: "gemini-2.0-flash",
    note: "Generous free tier for hobby projects.",
  },
  {
    id: "groq",
    label: "Groq",
    secret: "GROQ_API_KEY" as SecretKey,
    defaultModel: "llama-3.3-70b-versatile",
    note: "Very fast, open-weight models.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    secret: "OPENROUTER_API_KEY" as SecretKey,
    defaultModel: "anthropic/claude-sonnet-4",
    note: "One key, any model. Set the model id in Settings.",
  },
] as const;

export type LlmProviderId = (typeof LLM_PROVIDERS)[number]["id"];

export function resolveLlm(workspaceId: string) {
  const preferred = getSetting(workspaceId, "LLM_PROVIDER") as LlmProviderId | "";
  const candidates = preferred
    ? LLM_PROVIDERS.filter((p) => p.id === preferred)
    : LLM_PROVIDERS;

  for (const provider of candidates) {
    const key = getSecret(workspaceId, provider.secret);
    if (key) {
      return {
        provider,
        apiKey: key.value,
        model: getSetting(workspaceId, "LLM_MODEL") || provider.defaultModel,
      };
    }
  }
  return null;
}

export function hasLlm(workspaceId: string): boolean {
  return resolveLlm(workspaceId) !== null;
}

export interface ImagePart {
  /** image/jpeg or image/png. */
  mime: string;
  /** base64, without the data: prefix. */
  data: string;
}

export interface CompleteOptions {
  system: string;
  user: string;
  maxTokens?: number;
  /** Ask the model for a single JSON object and nothing else. */
  json?: boolean;
  /** Stills for the model to look at. Ignored where the provider cannot see. */
  images?: ImagePart[];
}

/**
 * Whether this provider's default endpoint accepts images. Groq and OpenRouter
 * can, but only on some models, so they stay text-only rather than failing a
 * whole request on a model the workspace happens to have chosen.
 */
export function visionCapable(providerId: string): boolean {
  return providerId === "anthropic" || providerId === "openai" || providerId === "google";
}

function anthropicContent(user: string, images?: ImagePart[]) {
  if (!images?.length) return user;
  return [
    ...images.map((image) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: image.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: image.data,
      },
    })),
    { type: "text" as const, text: user },
  ];
}

function openaiContent(user: string, images?: ImagePart[]) {
  if (!images?.length) return user;
  return [
    { type: "text", text: user },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mime};base64,${image.data}` },
    })),
  ];
}

export async function complete(
  workspaceId: string,
  opts: CompleteOptions,
): Promise<LlmResult> {
  const resolved = resolveLlm(workspaceId);
  if (!resolved) {
    throw new LlmUnavailable(
      "No language-model key is configured for this workspace. Add one in Settings → AI providers.",
    );
  }
  const { provider, apiKey, model } = resolved;
  const maxTokens = opts.maxTokens ?? 4096;

  const system = opts.json
    ? `${opts.system}\n\nRespond with a single JSON object and nothing else. No prose, no markdown fences.`
    : opts.system;

  try {
    switch (provider.id) {
      case "anthropic":
        return await anthropic(apiKey, model, system, opts.user, maxTokens, opts.images);
      case "openai":
        return await openaiCompatible(
          "https://api.openai.com/v1/chat/completions",
          apiKey,
          model,
          system,
          opts.user,
          maxTokens,
          "openai",
          opts.json,
          opts.images,
        );
      case "groq":
        return await openaiCompatible(
          "https://api.groq.com/openai/v1/chat/completions",
          apiKey,
          model,
          system,
          opts.user,
          maxTokens,
          "groq",
          opts.json,
          opts.images,
        );
      case "openrouter":
        return await openaiCompatible(
          "https://openrouter.ai/api/v1/chat/completions",
          apiKey,
          model,
          system,
          opts.user,
          maxTokens,
          "openrouter",
          opts.json,
          opts.images,
        );
      case "google":
        return await gemini(apiKey, model, system, opts.user, maxTokens, opts.json, opts.images);
    }
  } catch (err) {
    if (err instanceof LlmUnavailable) throw err;
    throw new LlmUnavailable(
      `${provider.label} request failed: ${(err as Error).message}`,
    );
  }
}

// ── Anthropic (official SDK) ────────────────────────────────────────────────

async function anthropic(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  images?: ImagePart[],
): Promise<LlmResult> {
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: anthropicContent(user, images) }],
    });

    if (response.stop_reason === "refusal") {
      throw new LlmUnavailable(
        "Claude declined to process this content. Try rewording the note.",
      );
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("\n")
      .trim();

    return { text, provider: "anthropic", model: response.model };
  } catch (err) {
    if (err instanceof LlmUnavailable) throw err;
    if (err instanceof Anthropic.AuthenticationError)
      throw new LlmUnavailable(
        "Anthropic rejected the API key. Check it in Settings → AI providers.",
      );
    if (err instanceof Anthropic.RateLimitError)
      throw new LlmUnavailable("Anthropic rate-limited this request. Try again shortly.");
    if (err instanceof Anthropic.NotFoundError)
      throw new LlmUnavailable(
        `Anthropic has no model called "${model}". Change it in Settings → AI providers.`,
      );
    if (err instanceof Anthropic.APIError)
      throw new LlmUnavailable(`Anthropic error ${err.status}: ${err.message}`);
    throw err;
  }
}

// ── OpenAI-shaped (OpenAI, Groq, OpenRouter) ────────────────────────────────

async function openaiCompatible(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  providerId: string,
  json?: boolean,
  images?: ImagePart[],
): Promise<LlmResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(providerId === "openrouter"
        ? { "X-Title": "Cutlist", "HTTP-Referer": process.env.APP_URL || "http://localhost:3000" }
        : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: openaiContent(user, images) },
      ],
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) throw new LlmUnavailable(await httpError(res, providerId));

  const data = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
  };
  return {
    text: (data.choices?.[0]?.message?.content ?? "").trim(),
    provider: providerId,
    model: data.model ?? model,
  };
}

// ── Google Gemini ───────────────────────────────────────────────────────────

async function gemini(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  json?: boolean,
  images?: ImagePart[],
): Promise<LlmResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: "user",
          parts: [
            ...(images ?? []).map((image) => ({
              inline_data: { mime_type: image.mime, data: image.data },
            })),
            { text: user },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2,
        ...(json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  if (!res.ok) throw new LlmUnavailable(await httpError(res, "google"));

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return { text, provider: "google", model };
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function httpError(res: Response, provider: string) {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  if (res.status === 401 || res.status === 403)
    return `${provider} rejected the API key. Check it in Settings → AI providers.`;
  if (res.status === 429)
    return `${provider} rate-limited this request. Try again shortly.`;
  if (res.status === 404)
    return `${provider} has no such model. Change the model id in Settings → AI providers.`;
  return `${provider} returned ${res.status}. ${detail}`;
}

/**
 * Models occasionally wrap JSON in prose or fences despite instruction.
 * Pull the outermost balanced object/array out of whatever came back.
 */
export function parseJson<T>(raw: string): T | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through to extraction */
  }

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = text.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
