import { id, now, one, run } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Google Drive, OAuth 2.0 authorisation-code flow.
 *
 * Tokens are stored per workspace, encrypted with APP_ENCRYPTION_KEY. A refresh
 * is performed lazily on read, so a connected workspace keeps working without a
 * background job.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export class DriveError extends Error {}

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${process.env.APP_URL || "http://localhost:3000"}/api/integrations/drive/callback`;

  if (!clientId || !clientSecret) {
    throw new DriveError(
      "Google Drive is not configured on this instance. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function driveAuthUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = config();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok)
    throw new DriveError(
      `Google rejected the authorisation code: ${(await res.text()).slice(0, 200)}`,
    );
  return (await res.json()) as TokenResponse;
}

/** Google puts the account email in the id_token payload; no extra call needed. */
function emailFromIdToken(idToken?: string): string {
  if (!idToken) return "";
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return String(json.email ?? "");
  } catch {
    return "";
  }
}

export function saveConnection(
  workspaceId: string,
  userId: string,
  tokens: TokenResponse,
) {
  const email = emailFromIdToken(tokens.id_token);
  const expiresAt = now() + (tokens.expires_in - 60) * 1000;

  const existing = one<{ id: string; refresh_enc: string | null }>(
    "SELECT id, refresh_enc FROM integrations WHERE workspace_id = ? AND provider = 'google_drive'",
    workspaceId,
  );

  // Google omits refresh_token on re-consent in some flows; keep the old one.
  const refreshEnc = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : (existing?.refresh_enc ?? null);

  if (existing) {
    run(
      `UPDATE integrations
          SET access_enc = ?, refresh_enc = ?, expires_at = ?, scope = ?,
              account_email = ?, connected_by = ?
        WHERE id = ?`,
      encryptSecret(tokens.access_token),
      refreshEnc,
      expiresAt,
      tokens.scope,
      email || "",
      userId,
      existing.id,
    );
  } else {
    run(
      `INSERT INTO integrations
         (id, workspace_id, provider, account_email, access_enc, refresh_enc, expires_at, scope, connected_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id("int"),
      workspaceId,
      "google_drive",
      email || "",
      encryptSecret(tokens.access_token),
      refreshEnc,
      expiresAt,
      tokens.scope,
      userId,
      now(),
    );
  }
}

export function getConnection(workspaceId: string) {
  return one<{
    id: string;
    account_email: string;
    access_enc: string | null;
    refresh_enc: string | null;
    expires_at: number;
    created_at: number;
  }>(
    "SELECT id, account_email, access_enc, refresh_enc, expires_at, created_at FROM integrations WHERE workspace_id = ? AND provider = 'google_drive'",
    workspaceId,
  );
}

export function disconnect(workspaceId: string) {
  const conn = getConnection(workspaceId);
  if (conn?.refresh_enc) {
    const token = decryptSecret(conn.refresh_enc);
    if (token) {
      // Best effort; the row goes regardless.
      void fetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => {});
    }
  }
  run(
    "DELETE FROM integrations WHERE workspace_id = ? AND provider = 'google_drive'",
    workspaceId,
  );
}

async function accessToken(workspaceId: string): Promise<string> {
  const conn = getConnection(workspaceId);
  if (!conn) throw new DriveError("This workspace has not connected Google Drive.");

  if (conn.access_enc && conn.expires_at > now()) {
    const token = decryptSecret(conn.access_enc);
    if (token) return token;
  }

  const refresh = conn.refresh_enc ? decryptSecret(conn.refresh_enc) : null;
  if (!refresh)
    throw new DriveError(
      "The Drive connection expired and no refresh token is stored. Reconnect in Settings.",
    );

  const { clientId, clientSecret } = config();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new DriveError(
      "Google refused to refresh the Drive token. Reconnect the account in Settings.",
    );
  }
  const data = (await res.json()) as TokenResponse;
  run(
    "UPDATE integrations SET access_enc = ?, expires_at = ? WHERE id = ?",
    encryptSecret(data.access_token),
    now() + (data.expires_in - 60) * 1000,
    conn.id,
  );
  return data.access_token;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  durationMs: number;
  /** Folder ids. One shoot in one folder is the whole identity story. */
  parents?: string[];
  thumbnailLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
}

export async function listVideos(
  workspaceId: string,
  options: { search?: string; pageToken?: string; folderId?: string } = {},
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const token = await accessToken(workspaceId);

  const clauses = ["mimeType contains 'video/'", "trashed = false"];
  if (options.search) {
    // Drive query strings use \' escaping inside single-quoted literals.
    const safe = options.search.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    clauses.push(`name contains '${safe}'`);
  }
  if (options.folderId) clauses.push(`'${options.folderId}' in parents`);

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", clauses.join(" and "));
  url.searchParams.set("pageSize", "40");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set(
    "fields",
    "nextPageToken, files(id, name, mimeType, size, thumbnailLink, webViewLink, modifiedTime, parents, videoMediaMetadata(durationMillis))",
  );
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (options.pageToken) url.searchParams.set("pageToken", options.pageToken);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok)
    throw new DriveError(
      `Drive listing failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );

  const data = (await res.json()) as {
    nextPageToken?: string;
    files?: {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      thumbnailLink?: string;
      webViewLink?: string;
      modifiedTime?: string;
      parents?: string[];
      videoMediaMetadata?: { durationMillis?: string };
    }[];
  };

  return {
    nextPageToken: data.nextPageToken,
    files: (data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: Number(f.size ?? 0),
      durationMs: Number(f.videoMediaMetadata?.durationMillis ?? 0),
      thumbnailLink: f.thumbnailLink,
      webViewLink: f.webViewLink,
      modifiedTime: f.modifiedTime,
      parents: f.parents ?? [],
    })),
  };
}

export interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
}

/** Quote a value for a Drive query string, which uses backslash escaping. */
function quoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Folders, so the picker can be folder-first. One shoot is one folder is one
 * reel, which is what keeps the clip the editor opens and the clip named in the
 * handoff the same file.
 */
export async function listFolders(
  workspaceId: string,
  options: { parentId?: string; search?: string; pageToken?: string } = {},
): Promise<{ folders: DriveFolder[]; nextPageToken?: string }> {
  const token = await accessToken(workspaceId);

  const clauses = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ];
  if (options.search) clauses.push(`name contains '${quoted(options.search)}'`);
  else clauses.push(`'${quoted(options.parentId || "root")}' in parents`);

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", clauses.join(" and "));
  url.searchParams.set("pageSize", "60");
  url.searchParams.set("orderBy", "folder, modifiedTime desc");
  url.searchParams.set(
    "fields",
    "nextPageToken, files(id, name, webViewLink, modifiedTime)",
  );
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (options.pageToken) url.searchParams.set("pageToken", options.pageToken);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok)
    throw new DriveError(
      `Drive folder listing failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );

  const data = (await res.json()) as {
    nextPageToken?: string;
    files?: DriveFolder[];
  };
  return { folders: data.files ?? [], nextPageToken: data.nextPageToken };
}

/** One file's identity: the name the editor sees, its size, and its link. */
export async function getFile(
  workspaceId: string,
  fileId: string,
): Promise<DriveFile> {
  const token = await accessToken(workspaceId);
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
  );
  url.searchParams.set(
    "fields",
    "id, name, mimeType, size, thumbnailLink, webViewLink, modifiedTime, parents, videoMediaMetadata(durationMillis)",
  );
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok)
    throw new DriveError(
      res.status === 404
        ? "That file is no longer in the connected Drive account. It may have been moved, renamed into another account, or trashed."
        : `Drive could not describe that file (${res.status}).`,
    );

  const f = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    thumbnailLink?: string;
    webViewLink?: string;
    modifiedTime?: string;
    parents?: string[];
    videoMediaMetadata?: { durationMillis?: string };
  };

  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size ?? 0),
    durationMs: Number(f.videoMediaMetadata?.durationMillis ?? 0),
    thumbnailLink: f.thumbnailLink,
    webViewLink: f.webViewLink,
    modifiedTime: f.modifiedTime,
    parents: f.parents ?? [],
  };
}

/**
 * Google's own thumbnail bytes. The link it hands back needs the workspace
 * token, which the browser does not have, so it is proxied.
 */
export async function thumbnail(
  workspaceId: string,
  fileId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const token = await accessToken(workspaceId);
  const meta = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
  );
  meta.searchParams.set("fields", "thumbnailLink");
  meta.searchParams.set("supportsAllDrives", "true");

  const metaRes = await fetch(meta, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) return null;

  const link = ((await metaRes.json()) as { thumbnailLink?: string }).thumbnailLink;
  if (!link) return null;

  // The default crop is tiny; ask for something a person can tell apart.
  const res = await fetch(link.replace(/=s\d+$/, "=s400"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "image/jpeg",
  };
}

/** Streams file bytes straight from Drive, used to serve imported clips. */
export async function streamFile(
  workspaceId: string,
  fileId: string,
  range?: string | null,
): Promise<Response> {
  const token = await accessToken(workspaceId);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers },
  );
  if (!res.ok && res.status !== 206)
    throw new DriveError(`Drive refused to stream this file (${res.status}).`);
  return res;
}
