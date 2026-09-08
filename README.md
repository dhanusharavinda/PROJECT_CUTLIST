# Cutlist

**A shared workspace where a creator talks over their footage and their editor gets a cut list.**

A creator with 100 videos in the pipeline already knows the edit — where to cut,
where the transition goes, which shot needs a blur. Getting that out of their
head and into the editor's has always meant a long message, a spreadsheet, or a
call.

Cutlist replaces that. The creator scrubs their own footage, holds the mic key,
and says it the way they'd say it out loud. Cutlist transcribes the recording,
works out *which kind of instruction* each sentence was, pins it to the frame
they were parked on, and drops it into a shared room the editor is already in.

---

## What it actually does

| | |
|---|---|
| **Voice notes anchored in time** | The playhead position is captured with the recording, so "cut this bit right here" resolves to a real frame instead of a guess. Explicit timestamps in speech ("at one thirty-eight") are parsed too, and carried across the rest of the sentence. |
| **Auto-labelling, not auto-summarising** | Every instruction is typed — cut, trim, transition, filter, colour, text, caption, b-roll, sfx, music, zoom, speed, blur, keep — split out of compound sentences and ranked by how hard the creator stressed it. |
| **A timeline you can read at a glance** | Markers sit on the scrubber in the colour of their instruction type. Click one, the player jumps there. Ranges render as bands, single moments as ticks. |
| **The creator brief** | A structured form — edit type, platform, aspect, pacing, tone, captions, music, guardrails, deliverables, deadline. Filled once. It is also what the AI reads when judging the creator's notes. |
| **A room, not a thread** | Live chat scoped to the project, with presence, and messages can carry a timestamp that jumps the player. |
| **Second-pair-of-eyes review** | Reads the brief, every transcript and the whole cut list *together*, then says what's missing, what will bite, and what to ask before starting. |
| **Google Drive** | Connect a Google account and attach footage without downloading anything — clips stream through the server using that account's token. |
| **Client isolation** | Separate clients live in separate workspaces, with their own members, footage, cut lists and API keys. Nothing crosses. |
| **Your keys, your bill** | STT and LLM keys are added *in the app*, encrypted at rest, scoped to one workspace. |
| **Export** | The cut list leaves as Markdown, CSV or JSON. It is not trapped in here. |

Cutlist is **fully usable with no API keys at all** — recordings are stored, and
an offline keyword-rules labeller extracts instructions so you can see the shape
of the product before paying anyone.

---

## Quick start

Requires **Node 22.5 or newer** (24 recommended). Cutlist uses Node's built-in
SQLite, so there is nothing to compile and no database to install.

```bash
npm install

# Windows PowerShell
Copy-Item .env.example .env.local
# macOS / Linux
cp .env.example .env.local
```

Generate the two required secrets and paste them into `.env.local`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # APP_ENCRYPTION_KEY
```

Then:

```bash
npm run seed     # optional — a worked example to look at
npm run dev
```

Open <http://localhost:3000>.

The seed creates a workspace with a filled brief, three voice notes with
transcripts, the cut list they produced, and a five-minute placeholder clip that
is generated locally so the player and timeline are live immediately:

| Role | Email | Password |
|---|---|---|
| Creator / owner | `ada@cutlist.local` | `cutlist123` |
| Editor | `theo@cutlist.local` | `cutlist123` |

Sign in as the editor to see the same project from the other side — read-only
brief, workable cut list.

Without the seed, sign up and you get your own empty workspace.

### Production

```bash
npm run build
npm start
```

`AUTH_SECRET` and `APP_ENCRYPTION_KEY` are **required** in production — the app
refuses to start without them rather than falling back to a dev default.

---

## Adding AI

None of this is required, but the product is much better with it.

Go to **Settings → AI providers** and paste a key. It is encrypted with
AES-256-GCM before it reaches the database, is never sent back to the browser,
and is readable only by the workspace it was added to. Anything set in
`.env.local` acts as an instance-wide fallback and is shown in the UI as `env`.

**Speech to text** — one of:

| Provider | Key | Notes |
|---|---|---|
| Groq (Whisper v3 turbo) | `GROQ_API_KEY` | Fastest. Good default for rapid-fire voice notes. |
| OpenAI (Whisper) | `OPENAI_API_KEY` | Word-accurate segments. Same key also drives the LLM if you want. |
| Deepgram (Nova) | `DEEPGRAM_API_KEY` | Strong punctuation and filler handling. |
| AssemblyAI | `ASSEMBLYAI_API_KEY` | Async — Cutlist polls until the transcript is ready. |

**Language model** — one of:

| Provider | Key | Default model |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Google Gemini | `GOOGLE_AI_API_KEY` | `gemini-2.0-flash` |
| Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| OpenRouter | `OPENROUTER_API_KEY` | set the model yourself |

Leave "Preferred provider" on **Auto** and Cutlist uses the first one that has a
key. Override the model per workspace in the same panel.

Without a speech-to-text key, recordings are still saved — you can type the
transcript yourself and the labeller runs on that. Without a language-model key,
labelling falls back to the keyword-rules pass, which is honest about itself:
those instructions are tagged `rules` in the UI.

---

## Connecting Google Drive

Drive needs an OAuth client, which is an **instance-level** setting rather than
a per-workspace one — so it lives in `.env.local`, not in the UI.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project and enable the **Google Drive API**.
2. Configure the OAuth consent screen. While it is in *Testing*, add yourself
   under **Test users** — otherwise Google will refuse the sign-in.
3. Create credentials → **OAuth client ID** → type **Web application**.
4. Add this exact **Authorised redirect URI**:

   ```
   http://localhost:3000/api/integrations/drive/callback
   ```

5. Put the client id and secret in `.env.local`:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/drive/callback
   ```

6. Restart, then **Settings → Google Drive → Connect**.

Cutlist requests `drive.readonly`. It can list and stream your video files; it
cannot modify or delete anything. Tokens are encrypted with
`APP_ENCRYPTION_KEY` and refreshed lazily.

---

## Roles

| | Owner | Creator | Editor | Viewer |
|---|:-:|:-:|:-:|:-:|
| Read everything in the workspace | ● | ● | ● | ● |
| Chat, record notes, work the cut list | ● | ● | ● | |
| Upload / attach footage | ● | ● | ● | |
| Write the brief, create projects | ● | ● | | |
| Manage members and AI keys | ● | ● | | |
| Delete the workspace | ● | | | |

Invites produce a one-use link. There is no mail server in the box — copy the
link and send it however you like.

---

## Keyboard (studio)

| Key | |
|---|---|
| `Space` / `K` | play / pause |
| `J` / `L` | back / forward 10s |
| `←` / `→` | back / forward 5s |
| `,` / `.` | step one frame |
| `R` | start / stop recording |
| `M` | mute |
| `F` | fullscreen |

Shortcuts are ignored while you're typing in a field.

---

## How it is built

```
src/
  app/
    page.tsx                     landing
    (auth)/                      sign in / sign up
    join/[token]/                invite acceptance
    app/                         the product (sidebar shell)
      page.tsx                     dashboard
      settings/                    AI keys, Drive, people
      projects/[id]/               brief · footage · cut list · review + room
      projects/[id]/studio/[vid]/  player · timeline · recorder · notes
    api/                         route handlers
  components/
    ui.tsx                       design-system primitives
    AppShell.tsx                 sidebar, workspace switcher
    project/                     brief, footage, cut list, review, room
    studio/                      timeline, recorder, notes panel
  lib/
    schema.ts                    the single source of truth for the DDL
    db.ts                        node:sqlite wrapper + migrations
    tenancy.ts                   the isolation boundary — read this first
    crypto.ts                    scrypt passwords, AES-256-GCM secrets
    brief.ts                     brief fields, declared once, used everywhere
    pipeline.ts                  voice note → transcript → cut list
    ai/                          stt.ts, llm.ts, labeler.ts, suggest.ts, keys.ts
    drive.ts                     Google OAuth + Drive listing/streaming
    bus.ts                       in-process pub/sub for SSE + presence
```

- **Next.js 15** (App Router) with React 19 and TypeScript.
- **Tailwind CSS v4** — tokens live in `src/app/globals.css`; there is no config file.
- **SQLite via `node:sqlite`** — no native build step, no service to run.
- **Realtime is server-sent events** over one connection per open project, with
  an in-process event bus. Single-instance by design; swap `lib/bus.ts` for
  Redis pub/sub to run more than one.
- **Auth** is a signed, HTTP-only session cookie; passwords are scrypt.
- **Media** lives on disk under `data/storage/<workspace>/…` and is served with
  HTTP range support so the player can seek.

### How client isolation works

Every tenant-owned row carries `workspace_id`, even where a join could derive
it. That redundancy is deliberate: it lets every read apply one uniform
`WHERE workspace_id = ?` predicate, so a missing join condition cannot leak
another workspace's rows.

`src/lib/tenancy.ts` is the only place that resolves the active workspace. A
workspace id may be *requested* (via cookie or argument) but is honoured only if
a membership backs it. Every scoped fetch — project, video, note, label — takes
the context and pins the workspace explicitly, and a row from another workspace
returns 404, indistinguishable from one that never existed.

Storage keys are workspace-prefixed and path-traversal is rejected before any
file is opened.

### The labelling pipeline

1. The recording uploads with the playhead position attached.
2. `lib/pipeline.ts` sends the audio to the configured STT provider and stores
   the transcript plus its timed segments.
3. `lib/ai/labeler.ts` runs the transcript through the language model with the
   creator's brief as context, and coerces the result into typed instructions
   clamped to the clip's duration.
4. If the model is unavailable or returns nothing usable, the keyword-rules pass
   runs instead — so a failure never loses the note.
5. Re-labelling replaces the machine output for that note but never touches
   instructions the editor typed by hand or has already started work on.

Correcting a transcript re-runs step 3 only; it does not pay for transcription
twice.

---

## Scripts

| | |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | populate an empty database with the worked example |
| `npm run db:reset -- --yes` | delete the database and all uploaded media |

`db:reset` will fail while the dev server is running — Windows keeps the SQLite
file locked. Stop the server first.

---

## Known limits

- **Single instance.** The event bus and presence map are in-process. Two
  instances behind a load balancer would not see each other's events.
- **No transcoding.** Clips are played by the browser as uploaded; a codec your
  browser cannot decode will not play. There is no ffmpeg dependency.
- **No email.** Invites are links you send yourself.
- **Drive scope is sensitive.** `drive.readonly` requires Google verification
  before a public app can use it. For your own account or listed test users it
  works immediately.
- **`node:sqlite` is still marked experimental** by Node and prints a warning on
  startup. The API it uses is stable in practice; swapping in `better-sqlite3`
  would be a change to one file.
- The seeded clip is a generated audio placeholder, not video — it exists so the
  player and timeline are live on a fresh install. Delete it and upload real
  footage.

---

## Security notes

- API keys and OAuth tokens are encrypted at rest (AES-256-GCM) and never
  returned to the browser — the UI only ever sees a hint like `sk-…4f2a`.
- Passwords are scrypt with a per-user salt; login failures are deliberately
  indistinguishable between "no such email" and "wrong password".
- Session cookies are HTTP-only, `SameSite=Lax`, and `Secure` in production.
- `.env.local` and `data/` are git-ignored. No secret is written to a file the
  app commits.
- Rotating `APP_ENCRYPTION_KEY` makes previously stored keys unreadable; users
  re-enter them.
