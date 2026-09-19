# Cutlist

**A shared workspace where a creator talks over their footage and their editor gets a cut list.**

A creator with 100 videos in the pipeline already knows the edit: where to cut,
where the transition goes, which shot needs a blur. Getting that out of their
head and into the editor's has always meant a long message, a spreadsheet, or a
call.

Cutlist replaces that. The creator scrubs their own footage, holds the mic key,
and says it the way they'd say it out loud. Cutlist transcribes the recording,
works out *which kind of instruction* each sentence was, pins it to the frame
they were parked on, and drops it into a shared room the editor is already in.

---

## What Cutlist is not

**It is not a video editor.** There is no rendering, no transcoding, no
re-encoding, no timeline surgery, and no ffmpeg dependency anywhere in the
codebase. Uploaded media is written to disk once, byte for byte, and thereafter
only read back by a `<video>` element. Nothing Cutlist does changes a frame of
your footage.

Your editor still cuts in Premiere, Resolve or Final Cut. Cutlist carries the
handoff and nothing else:

| | |
|---|---|
| The video | a reference player with a read-only marker track |
| The product | a timestamped, typed cut list: what, where, how |
| The input | the creator's voice, so the brief isn't typed twice |
| The output | Markdown, CSV or JSON the editor keeps outside this app |

The word "cut list" is the film term for the decision list handed to whoever
does the cutting. That is exactly what this produces: a document, not an edit.

---

## What it actually does

| | |
|---|---|
| **Voice notes anchored in time** | The playhead position is captured with the recording, so "cut this bit right here" resolves to a real frame instead of a guess. Explicit timestamps in speech ("at one thirty-eight") are parsed too, and carried across the rest of the sentence. |
| **Auto-labelling, not auto-summarising** | Every instruction is typed (cut, trim, transition, filter, colour, text, caption, b-roll, sfx, music, zoom, speed, blur, keep), split out of compound sentences and ranked by how hard the creator stressed it. |
| **"Where" becomes a click** | Markers sit on a reference scrubber in the colour of their instruction type. Click one, the player jumps there. Ranges render as bands, single moments as ticks. Seek and select are the only interactions. Nothing here writes to media. |
| **Questions land on the instruction** | The editor asks *on* the punch-in at 1:41, not three screens up in the room. The thread lives on that row, the creator sees "needs an answer" against it, and both sides stop re-describing which moment they mean. |
| **The creator brief** | A structured form: edit type, platform, aspect, pacing, tone, captions, music, guardrails, deliverables, deadline. Filled once. It is also what the AI reads when judging the creator's notes. |
| **A room, not a thread** | Live chat scoped to the project, with presence, and messages can carry a timestamp that jumps the player. |
| **Second-pair-of-eyes review** | Reads the brief, every transcript and the whole cut list *together*, then says what's missing, what will bite, and what to ask before starting. |
| **Google Drive** | Connect a Google account and attach footage without downloading anything. Clips stream through the server using that account's token. |
| **Client isolation** | Separate clients live in separate workspaces, with their own members, footage, cut lists and API keys. Nothing crosses. |
| **Your keys, your bill** | STT and LLM keys are added *in the app*, encrypted at rest, scoped to one workspace. |
| **Export** | The cut list leaves as Markdown, CSV or JSON. It is not trapped in here. |

Cutlist is **fully usable with no API keys at all**. Recordings are stored, and
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
npm run seed     # optional: a worked example to look at
npm run dev
```

Open <http://localhost:3000>.

The seed creates a workspace with a filled brief, three voice notes with
transcripts, the cut list they produced, and a five-minute placeholder clip that
is generated locally so the player and marker track are live immediately:

| Role | Email | Password |
|---|---|---|
| Creator / owner | `ada@cutlist.local` | `cutlist123` |
| Editor | `theo@cutlist.local` | `cutlist123` |

Sign in as the editor to see the same project from the other side: read-only
brief, workable cut list, and the ability to ask a question against any single
instruction.

Without the seed, sign up and you get your own empty workspace.

### Production

```bash
npm run build
npm start
```

`AUTH_SECRET` and `APP_ENCRYPTION_KEY` are **required** in production. The app
refuses to start without them rather than falling back to a dev default.

---

## The reel, and what your editor gets

A reel is an ordered list of segments: a clip, an in point, an out point, and why
it is there. The app never edits video. Its output is one file you send.

Open a project and press **Open reel**.

1. **Start from footage** fills the reel with every clip, whole, in the order you
   shot them, so the job is subtracting and rearranging rather than building from
   nothing. A clip whose length is not known yet is left out and counted, never
   dropped quietly.
2. **Reorder and trim.** Each slot has buttons, and keys for the same actions:

   | Key | |
   |---|---|
   | `Up` / `Down` | select the slot above or below |
   | `[` / `]` | move the selected slot up or down |
   | `D` | duplicate it (a hook shot reused at the end is a second slot) |
   | `Backspace` | take it out of the reel |
   | `Enter` | open the trim strip, `Escape` closes it |
   | `Space` / `K` | play or pause the reel |
   | `M` | mute |

   Trimming is optional. In the trim strip, clicking a frame sets the in point
   and shift-clicking sets the out point, both snapping to a detected cut when
   one is close. One clip can appear in as many slots as you like.
3. **Watch it in order.** The stage plays the slots back to back, honouring every
   in and out point, with the instruction cues floating over the picture. Muted by
   default, because the music is the editor's job.
4. **One number**: the runtime against the target for your niche. Everything else
   the analyser knows stays out of the way.
5. **Send to editor** builds the packet.

### The packet

One self-contained HTML file, named `<project>-packet-v<n>.html`. It opens on any
machine, offline, with no account and no login, and it carries:

- The runtime, the build time and a version number, so a stale copy is obvious.
- A link to the Drive folder, and per slot an **Open in Drive** link.
- Each slot in order with **the two frames it names**: the real in frame and the
  real out frame, grabbed at build time and inlined. Where a slot is the whole
  clip there is one frame. Where the clip has no local copy, the analyser's
  nearest frame is shown and labelled as exactly that, so it is never mistaken
  for the in point.
- The **real Drive filename** for every slot, never the title you gave it here,
  because the filename is what your editor searches for.
- That slot's instructions as coloured chips with a checkbox each. Ticks live in
  your editor's own browser, keyed to the instruction, so a reorder or a new
  version does not wipe them. A **Copy progress** button turns their ticks into a
  line they can paste back to you.
- Project-wide advice printed once rather than repeated under every slot, a
  **Sound** line per slot plus the track for the reel, anything you said that
  landed outside every slot, and one sentence stating what the in and out points
  mean and how accurate they are.

It refuses to build when it would send your editor somewhere they cannot go: a
slot pointing at a deleted clip, a clip with no link, or no Drive folder set. It
names the slots at fault instead of shipping a broken document.

### The other exports

`Export` in the project header also gives Markdown grouped in reel order, CSV,
JSON, and an EDL of sequential events carrying the Drive filenames. The EDL
refuses when the clips mix frame rates, because one rate would drift the
timecodes further with every cut.

---

## Footage analysis and edit plans

Cutlist can read the footage itself and suggest an edit. It never touches the
media: the output is markers and a plan you execute in CapCut, Edits, DaVinci or
Premiere.

Open a project, go to **Plan**, pick the clip and press **Analyse footage**.
This runs locally through ffmpeg and costs nothing:

| Measured | Used for |
|---|---|
| Every cut, and how long each shot holds | Pacing against the target for your niche |
| Motion per shot, and its peak | Slow motion and speed ramps on the peak of a rep |
| Brightness, saturation and dominant hue | Shots that break the colour or exposure run |
| Locked-off shots | Where masking, freezes and clones are actually possible |
| Tempo, beat grid and drops | Cuts that land on the beat, hits on the drop |
| Silence and speech | Dead air to cut, talking stretches that need B-roll |
| Thumbnails, one per shot | The filmstrip, and what a model is shown |

With a speech-to-text key connected it also transcribes the clip, which is what
finds the hook line in a vlog.

Then press **Generate plan**. The offline planner always runs. If a
language-model key is connected, the measurements plus up to twelve stills go to
the model and its plan replaces the offline one, keeping any offline finding it
did not cover. A 60 second reel costs a fraction of a cent to a few cents
depending on the provider, because the model is sent the shot table rather than
the video.

Each suggestion is a suggestion until you tick it into the cut list, where it
behaves like any other instruction: it shows on the marker track, exports, and
can be ticked off.

### Presets

| Preset | Shot hold | Built around |
|---|---|---|
| Gym edit | 0.7s to 2.2s | Cuts on the beat, slow motion on the peak rep, hits on the drop |
| Aesthetic reel | 0.5s to 1.5s | One consistent look, shot variety, match cuts |
| Surreal edit | 0.8s to 3.0s | Finding the locked-off plates an effect needs |
| Mini vlog | 2.0s to 5.0s | Hook line, dead air, B-roll gaps, captions |

Every plan also checks the hook (the first 1.5 seconds), the 9:16 framing, the
Instagram safe areas, and picks a cover frame. Caption, hashtag and on-screen
text drafts come with it.

### Reference reels

Mark a clip you want to imitate as a **reference** in the Plan tab and analyse
it. Cutlist pulls out its rhythm (shot count, median hold, cuts per minute, BPM,
how much of it cuts on the beat) and the plan compares your clip against it.
Only use reels you have a copy of; nothing is downloaded from Instagram.

### Clip library

Every analysed clip is tagged by what is in it (9:16, golden hour, warm, dark,
locked-off, music, talking, many cuts) and listed under **Clip library** in the
sidebar. With an AI key the model adds subject tags such as gym, mirror or
coffee. It is how you find a shot when you cannot remember the project.

### ffmpeg

Analysis needs ffmpeg and ffprobe. The bundled binaries are installed with the
other dependencies and found automatically:

```bash
npm install ffmpeg-static ffprobe-static
```

To use your own build instead, set `FFMPEG_PATH` and `FFPROBE_PATH` in
`.env.local`. Without either, everything else in Cutlist still works and the
Plan tab says what is missing.

### Solo mode

**Settings > How you work > Solo mode** hides the chat room and the presence
avatars, for when you shoot, edit and post on your own. The brief, the footage
analysis and the cut list stay.

---

## Adding AI

None of this is required, but the product is much better with it.

Go to **Settings → AI providers** and paste a key. It is encrypted with
AES-256-GCM before it reaches the database, is never sent back to the browser,
and is readable only by the workspace it was added to. Anything set in
`.env.local` acts as an instance-wide fallback and is shown in the UI as `env`.

**Speech to text**, one of:

| Provider | Key | Notes |
|---|---|---|
| Groq (Whisper v3 turbo) | `GROQ_API_KEY` | Fastest. Good default for rapid-fire voice notes. |
| OpenAI (Whisper) | `OPENAI_API_KEY` | Word-accurate segments. Same key also drives the LLM if you want. |
| Deepgram (Nova) | `DEEPGRAM_API_KEY` | Strong punctuation and filler handling. |
| AssemblyAI | `ASSEMBLYAI_API_KEY` | Async. Cutlist polls until the transcript is ready. |

**Language model**, one of:

| Provider | Key | Default model |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Google Gemini | `GOOGLE_AI_API_KEY` | `gemini-2.0-flash` |
| Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| OpenRouter | `OPENROUTER_API_KEY` | set the model yourself |

Leave "Preferred provider" on **Auto** and Cutlist uses the first one that has a
key. Override the model per workspace in the same panel.

Without a speech-to-text key, recordings are still saved. You can type the
transcript yourself and the labeller runs on that. Without a language-model key,
labelling falls back to the keyword-rules pass, which is honest about itself:
those instructions are tagged `rules` in the UI.

---

## Connecting Google Drive

Drive needs an OAuth client, which is an **instance-level** setting rather than
a per-workspace one, so it lives in `.env.local`, not in the UI.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project and enable the **Google Drive API**.
2. Configure the OAuth consent screen. While it is in *Testing*, add yourself
   under **Test users**, otherwise Google will refuse the sign-in.
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

Cutlist requests `drive.readonly`. It can list and read your video files; it
cannot modify or delete anything in Drive. Tokens are encrypted with
`APP_ENCRYPTION_KEY` and refreshed lazily.

### How footage actually flows

Keep **one shoot in one Drive folder**. That folder is what your editor gets
sent, so everything downstream stays pointed at the same files.

1. **Footage > From Drive** opens folder-first. Pick the folder, tick the clips,
   attach them in one go. Each clip keeps its real Drive filename and its Drive
   link, which is what makes "shot 3" resolvable to a file later.
2. Cutlist then makes **its own working copy** of each clip, one at a time, and
   the card shows the progress. Your Drive original is never touched.
3. If the original will not play in a browser (an iPhone HEVC `.mov`, say), it
   also writes a **720p H.264 preview** and plays that instead. The analysis
   still measures the original.
4. With a local copy the clip gets shots, motion, colour, beats, silences,
   thumbnails and tags, and scrubbing is instant instead of a round trip to
   Google on every seek.

The copy is a cache, not a second master. The Footage tab shows how much disk
this project is using, and **release** gives it back: the clip stays attached and
streams from Drive again. `IMPORT_MAX_MB` in `.env.local` caps a single clip and
defaults to 4096.

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

Invites produce a one-use link. There is no mail server in the box. Copy the
link and send it however you like.

---

## Keyboard (walkthrough)

| Key | |
|---|---|
| `Space` / `K` | play / pause |
| `J` / `L` | back / forward 10s |
| `←` / `→` | back / forward 5s |
| `,` / `.` | step one frame |
| `R` | start / stop recording |
| `M` | mute |
| `F` | fullscreen |
| `I` | hide or show the floating instructions |
| `O` | fold out the detail of the current one |
| `G` | show Instagram's safe areas |
| `?` | open the help guide |

Shortcuts are ignored while you're typing in a field. Click any note (its text,
its timestamp, or its dot on the marker track) to jump the player to the moment
it was recorded.

### Instructions on the picture

In the walkthrough the instructions float over the video rather than filling a
panel: one card at a time, bottom left, and only while the playhead is inside
the moment it applies to. Between instructions the frame is clean.

- The card carries the type, the timecode and the instruction. `O` folds out the
  detail, and a `+2` pill appears when several instructions share a moment.
- `I` hides and shows the layer. The choice is remembered per browser.
- `G` draws Instagram's safe areas, so text and faces stay clear of the caption
  strip and the buttons on the right.
- Hovering the marker track names what sits under the pointer, and picking a
  marker scrolls to that row in the cut list instead of silently filtering it
  away.
- The card disappears while you are recording, because you are talking rather
  than reading.
- The stage takes the shape of the clip, so 9:16 phone footage fills it instead
  of sitting between black bars.

---

## How it is built

```
src/
  app/
    page.tsx                     landing
    error.tsx / not-found.tsx    app-wide failure + 404 screens
    global-error.tsx             last resort, no stylesheet assumed
    (auth)/                      sign in / sign up
    join/[token]/                invite acceptance
    app/                         the product (sidebar shell)
      page.tsx                     dashboard
      loading.tsx                  skeleton shaped like the dashboard
      error.tsx / not-found.tsx    failures that keep the sidebar
      settings/                    AI keys, Drive, people
      projects/[id]/               brief · footage · plan · cut list · review + room
      library/                     every clip in the workspace, by tag
      projects/[id]/walkthrough/[v]/ reference player · markers · recorder · notes
    api/                         route handlers
  components/
    ui.tsx                       design-system primitives
    AppShell.tsx                 sidebar, workspace switcher, skip link
    Fallback.tsx                 shared shape for every dead end
    EmptyArt.tsx                 line art for the empty states
    project/                     brief, footage, cut list, review, room
    walkthrough/                 marker track, recorder, notes panel
  lib/
    schema.ts                    the single source of truth for the DDL
    db.ts                        node:sqlite wrapper + migrations
    tenancy.ts                   the isolation boundary, read this first
    crypto.ts                    scrypt passwords, AES-256-GCM secrets
    brief.ts                     brief fields, declared once, used everywhere
    pipeline.ts                  voice note → transcript → cut list
    ai/                          stt.ts, llm.ts, labeler.ts, suggest.ts, keys.ts
    analysis/                    ffmpeg, scene + beat detection, planner, vision
    media/localize.ts            Drive to disk, preview copies, the import queue
    reel/time.ts                 when an instruction counts as "now", reel maths
    reel/store.ts                the ordered slots, and which instruction lands in which
    reel/packet.ts               everything the handoff needs, in one object
    reel/render.ts               that object as one self-contained HTML file
    drive.ts                     Google OAuth + Drive listing/streaming
    bus.ts                       in-process pub/sub for SSE + presence
```

- **Next.js 15** (App Router) with React 19 and TypeScript.
- **Tailwind CSS v4**: tokens live in `src/app/globals.css`; there is no config file.
- **SQLite via `node:sqlite`**: no native build step, no service to run.
- **Realtime is server-sent events** over one connection per open project, with
  an in-process event bus. Single-instance by design; swap `lib/bus.ts` for
  Redis pub/sub to run more than one.
- **Auth** is a signed, HTTP-only session cookie; passwords are scrypt.
- **Media** lives on disk under `data/storage/<workspace>/…` and is served with
  HTTP range support so the player can seek.
- **Accessibility**: every icon-only control carries an `aria-label`, the type
  ramp meets WCAG AA on the app background, focus is always visible, dialogs
  trap Tab and restore focus on close, and a skip link opens the tab order.
- **No dead ends**: 404s, thrown errors, an expired session, a lost workspace
  membership and a dropped realtime connection each get a named screen or
  banner with a way out. No raw stack trace reaches the browser.

### How client isolation works

Every tenant-owned row carries `workspace_id`, even where a join could derive
it. That redundancy is deliberate: it lets every read apply one uniform
`WHERE workspace_id = ?` predicate, so a missing join condition cannot leak
another workspace's rows.

`src/lib/tenancy.ts` is the only place that resolves the active workspace. A
workspace id may be *requested* (via cookie or argument) but is honoured only if
a membership backs it. Every scoped fetch (project, video, note, label) takes
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
   runs instead, so a failure never loses the note.
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

`db:reset` will fail while the dev server is running. Windows keeps the SQLite
file locked. Stop the server first.

---

## Known limits

- **Single instance.** The event bus and presence map are in-process. Two
  instances behind a load balancer would not see each other's events.
- **Transcoding only for playback.** Nothing is ever re-encoded as a
  deliverable. The one exception is the 720p H.264 preview Cutlist writes when
  the original will not decode in a browser, so the player and the timeline
  work on phone footage. The original stays untouched and is what the analyser
  measures.
- **No email.** Invites are links you send yourself.
- **Drive scope is sensitive.** `drive.readonly` requires Google verification
  before a public app can use it. For your own account or listed test users it
  works immediately.
- **`node:sqlite` is still marked experimental** by Node and prints a warning on
  startup. The API it uses is stable in practice; swapping in `better-sqlite3`
  would be a change to one file.
- The seeded clip is a generated audio placeholder, not video. It exists so the
  player and marker track are live on a fresh install. Delete it and upload real
  footage.

---

## Security notes

- API keys and OAuth tokens are encrypted at rest (AES-256-GCM) and never
  returned to the browser. The UI only ever sees a hint like `sk-…4f2a`.
- Passwords are scrypt with a per-user salt; login failures are deliberately
  indistinguishable between "no such email" and "wrong password".
- Session cookies are HTTP-only, `SameSite=Lax`, and `Secure` in production.
- `.env.local` and `data/` are git-ignored. No secret is written to a file the
  app commits.
- Rotating `APP_ENCRYPTION_KEY` makes previously stored keys unreadable; users
  re-enter them.
