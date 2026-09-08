import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/** Deterministic 32-byte key from an env var, so a missing/short value still boots in dev. */
function keyFrom(envName: string, fallbackLabel: string): Buffer {
  const raw = process.env[envName];
  if (!raw || raw.startsWith("replace-me")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `${envName} is not set. Generate one with:\n  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    // Dev-only stable fallback so `npm run dev` works before .env.local exists.
    return scryptSync(`cutlist-dev-${fallbackLabel}`, "cutlist-dev-salt", 32);
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length >= 32) return buf.subarray(0, 32);
  return scryptSync(raw, "cutlist-kdf-salt", 32);
}

// ── Passwords ───────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, salt, hash] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const actual = scryptSync(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64"),
      expected.length,
      { N: Number(N), r: Number(r), p: Number(p) },
    );
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── Signed values (session cookies) ─────────────────────────────────────────

export function sign(value: string): string {
  const mac = createHmac("sha256", keyFrom("AUTH_SECRET", "auth"))
    .update(value)
    .digest("base64url");
  return `${value}.${mac}`;
}

export function unsign(signed: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const expected = sign(value);
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

// ── Secrets at rest (AES-256-GCM) ───────────────────────────────────────────

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyFrom("APP_ENCRYPTION_KEY", "enc"),
    iv,
  );
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string | null {
  try {
    const [version, iv, tag, data] = payload.split(":");
    if (version !== "v1") return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFrom("APP_ENCRYPTION_KEY", "enc"),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** `sk-…4f2a` — enough to recognise a key without revealing it. */
export function keyHint(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
