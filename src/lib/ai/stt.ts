import { getSecret, getSetting, type SecretKey } from "./keys";

export interface SttSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
}

export interface SttResult {
  text: string;
  segments: SttSegment[];
  provider: string;
  model: string;
  language?: string;
}

export class SttUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttUnavailable";
  }
}

export const STT_PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI Whisper",
    secret: "OPENAI_API_KEY" as SecretKey,
    defaultModel: "whisper-1",
    note: "Word-accurate segments, ~40 s for a 2-minute note.",
  },
  {
    id: "groq",
    label: "Groq Whisper v3",
    secret: "GROQ_API_KEY" as SecretKey,
    defaultModel: "whisper-large-v3-turbo",
    note: "Fastest of the four. Good default for rapid-fire voice notes.",
  },
  {
    id: "deepgram",
    label: "Deepgram Nova",
    secret: "DEEPGRAM_API_KEY" as SecretKey,
    defaultModel: "nova-2",
    note: "Strong punctuation and filler-word handling.",
  },
  {
    id: "assemblyai",
    label: "AssemblyAI",
    secret: "ASSEMBLYAI_API_KEY" as SecretKey,
    defaultModel: "best",
    note: "Async. Cutlist polls until the transcript is ready.",
  },
] as const;

export type SttProviderId = (typeof STT_PROVIDERS)[number]["id"];

/** Which provider will actually run for this workspace, if any. */
export function resolveStt(workspaceId: string) {
  const preferred = getSetting(workspaceId, "STT_PROVIDER") as SttProviderId | "";
  const candidates = preferred
    ? STT_PROVIDERS.filter((p) => p.id === preferred)
    : STT_PROVIDERS;

  for (const provider of candidates) {
    const key = getSecret(workspaceId, provider.secret);
    if (key) {
      return {
        provider,
        apiKey: key.value,
        model: getSetting(workspaceId, "STT_MODEL") || provider.defaultModel,
      };
    }
  }
  return null;
}

export async function transcribe(
  workspaceId: string,
  audio: Buffer,
  filename: string,
  mime: string,
): Promise<SttResult> {
  const resolved = resolveStt(workspaceId);
  if (!resolved) {
    throw new SttUnavailable(
      "No speech-to-text key is configured for this workspace. Add one in Settings → AI providers.",
    );
  }
  const { provider, apiKey, model } = resolved;

  switch (provider.id) {
    case "openai":
      return whisperCompatible(
        "https://api.openai.com/v1/audio/transcriptions",
        apiKey,
        model,
        audio,
        filename,
        mime,
        "openai",
      );
    case "groq":
      return whisperCompatible(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        apiKey,
        model,
        audio,
        filename,
        mime,
        "groq",
      );
    case "deepgram":
      return deepgram(apiKey, model, audio, mime);
    case "assemblyai":
      return assemblyai(apiKey, audio, mime);
  }
}

// ── OpenAI-compatible (/v1/audio/transcriptions) ────────────────────────────

async function whisperCompatible(
  url: string,
  apiKey: string,
  model: string,
  audio: Buffer,
  filename: string,
  mime: string,
  providerId: string,
): Promise<SttResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append(
    "prompt",
    "Editing direction for a video editor. Expect timestamps, jump cut, b-roll, lower third, LUT, transition, zoom, caption.",
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new SttUnavailable(await providerError(res, providerId));

  const data = (await res.json()) as {
    text?: string;
    language?: string;
    segments?: {
      start: number;
      end: number;
      text: string;
      no_speech_prob?: number;
      avg_logprob?: number;
    }[];
  };

  const segments: SttSegment[] = (data.segments ?? []).map((s) => ({
    start_ms: Math.round((s.start ?? 0) * 1000),
    end_ms: Math.round((s.end ?? 0) * 1000),
    text: (s.text ?? "").trim(),
    confidence:
      s.avg_logprob !== undefined
        ? clamp01(Math.exp(s.avg_logprob))
        : 1 - (s.no_speech_prob ?? 0),
  }));

  const text = (data.text ?? segments.map((s) => s.text).join(" ")).trim();
  return {
    text,
    segments: segments.length ? segments : wholeAsSegment(text),
    provider: providerId,
    model,
    language: data.language,
  };
}

// ── Deepgram ────────────────────────────────────────────────────────────────

async function deepgram(
  apiKey: string,
  model: string,
  audio: Buffer,
  mime: string,
): Promise<SttResult> {
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("paragraphs", "true");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": mime },
    body: new Uint8Array(audio),
  });
  if (!res.ok) throw new SttUnavailable(await providerError(res, "deepgram"));

  const data = (await res.json()) as {
    results?: {
      channels?: {
        alternatives?: {
          transcript?: string;
          confidence?: number;
          paragraphs?: {
            paragraphs?: {
              sentences?: { text: string; start: number; end: number }[];
            }[];
          };
        }[];
      }[];
    };
  };

  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  const text = (alt?.transcript ?? "").trim();
  const sentences =
    alt?.paragraphs?.paragraphs?.flatMap((p) => p.sentences ?? []) ?? [];

  const segments: SttSegment[] = sentences.map((s) => ({
    start_ms: Math.round(s.start * 1000),
    end_ms: Math.round(s.end * 1000),
    text: s.text.trim(),
    confidence: alt?.confidence ?? 0.9,
  }));

  return {
    text,
    segments: segments.length ? segments : wholeAsSegment(text),
    provider: "deepgram",
    model,
  };
}

// ── AssemblyAI (upload → submit → poll) ─────────────────────────────────────

async function assemblyai(
  apiKey: string,
  audio: Buffer,
  _mime: string,
): Promise<SttResult> {
  const headers = { authorization: apiKey };

  const upload = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { ...headers, "content-type": "application/octet-stream" },
    body: new Uint8Array(audio),
  });
  if (!upload.ok)
    throw new SttUnavailable(await providerError(upload, "assemblyai"));
  const { upload_url } = (await upload.json()) as { upload_url: string };

  const submit = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, punctuate: true, format_text: true }),
  });
  if (!submit.ok)
    throw new SttUnavailable(await providerError(submit, "assemblyai"));
  const submitted = (await submit.json()) as { id: string };

  // Voice notes are short; 90 s of polling is generous.
  for (let attempt = 0; attempt < 45; attempt++) {
    await sleep(2000);
    const poll = await fetch(
      `https://api.assemblyai.com/v2/transcript/${submitted.id}`,
      { headers },
    );
    if (!poll.ok) continue;
    const data = (await poll.json()) as {
      status: string;
      text?: string;
      error?: string;
      words?: { text: string; start: number; end: number; confidence: number }[];
    };
    if (data.status === "error")
      throw new SttUnavailable(data.error || "AssemblyAI could not transcribe this audio.");
    if (data.status !== "completed") continue;

    const text = (data.text ?? "").trim();
    return {
      text,
      segments: groupWords(data.words ?? []) ?? wholeAsSegment(text),
      provider: "assemblyai",
      model: "best",
    };
  }
  throw new SttUnavailable("AssemblyAI timed out. Try again in a moment.");
}

/** AssemblyAI returns words; roll them into ~8-second sentence-ish chunks. */
function groupWords(
  words: { text: string; start: number; end: number; confidence: number }[],
): SttSegment[] | null {
  if (!words.length) return null;
  const out: SttSegment[] = [];
  let current: SttSegment | null = null;

  for (const word of words) {
    if (!current) {
      current = {
        start_ms: word.start,
        end_ms: word.end,
        text: word.text,
        confidence: word.confidence,
      };
      continue;
    }
    const tooLong = word.end - current.start_ms > 8000;
    const endsSentence = /[.!?]$/.test(current.text);
    if (tooLong || endsSentence) {
      out.push(current);
      current = {
        start_ms: word.start,
        end_ms: word.end,
        text: word.text,
        confidence: word.confidence,
      };
    } else {
      current.text += ` ${word.text}`;
      current.end_ms = word.end;
      current.confidence = (current.confidence + word.confidence) / 2;
    }
  }
  if (current) out.push(current);
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function wholeAsSegment(text: string): SttSegment[] {
  return text ? [{ start_ms: 0, end_ms: 0, text, confidence: 0.8 }] : [];
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function providerError(res: Response, provider: string) {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      detail =
        typeof parsed.error === "string"
          ? parsed.error
          : (parsed.error?.message ?? text.slice(0, 200));
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    /* body already consumed */
  }
  if (res.status === 401 || res.status === 403)
    return `${provider} rejected the API key. Check it in Settings → AI providers.`;
  if (res.status === 429)
    return `${provider} rate-limited this request. Wait a moment and retry.`;
  return `${provider} returned ${res.status}. ${detail}`.trim();
}
