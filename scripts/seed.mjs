import fs from "node:fs";
import path from "node:path";
import { dataDir, hashPassword, id, now, openDb } from "./lib.mjs";

/**
 * Fills an empty database with one worked example: a creator, an editor, a
 * filled-in brief, three voice notes with transcripts, and the cut list those
 * notes produce. Enough to see what the product does before recording anything.
 */

const PASSWORD = "cutlist123";
const db = await openDb();

if (db.prepare("SELECT id FROM users LIMIT 1").get()) {
  console.log(
    "The database already has users — seeding would collide with them.\n" +
      "Start clean with:  npm run db:reset -- --yes  &&  npm run seed",
  );
  process.exit(1);
}

const insert = (sql, ...params) => db.prepare(sql).run(...params);
const t = now();
const ago = (minutes) => t - minutes * 60_000;

// ── People ──────────────────────────────────────────────────────────────────

const ada = id("usr");
const theo = id("usr");

insert(
  "INSERT INTO users (id, email, name, password_hash, accent, created_at) VALUES (?,?,?,?,?,?)",
  ada,
  "ada@cutlist.local",
  "Ada Okafor",
  hashPassword(PASSWORD),
  "lime",
  ago(60 * 24 * 30),
);
insert(
  "INSERT INTO users (id, email, name, password_hash, accent, created_at) VALUES (?,?,?,?,?,?)",
  theo,
  "theo@cutlist.local",
  "Theo Marsh",
  hashPassword(PASSWORD),
  "lime",
  ago(60 * 24 * 21),
);

const workspace = id("wsp");
insert(
  "INSERT INTO workspaces (id, name, slug, owner_id, created_at) VALUES (?,?,?,?,?)",
  workspace,
  "Northlight",
  "northlight",
  ada,
  ago(60 * 24 * 30),
);
insert(
  "INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
  id("mem"),
  workspace,
  ada,
  "owner",
  ago(60 * 24 * 30),
);
insert(
  "INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
  id("mem"),
  workspace,
  theo,
  "editor",
  ago(60 * 24 * 21),
);

// ── Project + brief ─────────────────────────────────────────────────────────

const project = id("prj");
insert(
  `INSERT INTO projects (id, workspace_id, name, summary, status, due_at, created_by, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  project,
  workspace,
  "Ep. 42 — Building a studio in a spare room",
  "Long-form YouTube with a vertical cut for Shorts. Second time we've filmed this room, so match the last one.",
  "editing",
  t + 1000 * 60 * 60 * 24 * 6,
  ada,
  ago(60 * 26),
  ago(38),
);

const brief = {
  editType: "Tutorial / how-to",
  platform: ["YouTube (long)", "YouTube Shorts"],
  aspect: "Both 16:9 and 9:16",
  targetLength: "12–14 min long, 45s vertical",
  pacing: "Fast and punchy",
  tone: ["Educational", "Raw and authentic"],
  references:
    "https://youtu.be/example — I want the b-roll rhythm from this, cuts landing on the beat",
  captions: "Burned-in, styled",
  music: "Lo-fi under the build montage, nothing under the talking sections",
  musicSource: "Epidemic Sound — login in the shared drive",
  brollSource: "Drive folder 'Studio build — b-roll'",
  branding:
    "Lower third: Inter Semibold, #D6F55E on 60% black.\nIntro sting: /branding/northlight-sting.mov\nNo logo bug over the demos.",
  doNots:
    "No zoom effects during the intro\nNever cut mid-sentence\nDon't use the shot where the tripod is in frame",
  mustKeep: "The bit where the shelf collapses — that's the whole video.",
  sensitive: "Any parcel or envelope on the shelf (address is visible)",
  deliverables: ["Master export", "Vertical cut", "Thumbnail frames", "Caption file (.srt)"],
  deadline: new Date(t + 1000 * 60 * 60 * 24 * 6).toISOString().slice(0, 10),
  notes:
    "This one's sponsored, so the read at ~8:00 has to stay intact and uncut. Everything else is fair game.",
};

insert(
  "INSERT INTO briefs (project_id, workspace_id, payload, completeness, updated_by, updated_at) VALUES (?,?,?,?,?,?)",
  project,
  workspace,
  JSON.stringify(brief),
  100,
  ada,
  ago(60 * 25),
);

// ── Footage ─────────────────────────────────────────────────────────────────
//
// A real, playable five-minute media file, synthesised here rather than
// downloaded. Encoding actual video would need ffmpeg; a WAV needs nothing but
// a header and a loop, and a <video> element plays it happily — so the player,
// the scrubber and the timeline are all genuinely live on a fresh install with
// no network at all. Replace it with your own upload; it exists to be deleted.

const CLIP_SECONDS = 300;
const clipBytes = renderScratchTrack(CLIP_SECONDS);
const storageKey = `${workspace}/video/seed-scratch-assembly.wav`;
const clipPath = path.join(dataDir(), "storage", storageKey);
fs.mkdirSync(path.dirname(clipPath), { recursive: true });
fs.writeFileSync(clipPath, clipBytes);

const video = id("vid");
insert(
  `INSERT INTO videos (id, workspace_id, project_id, title, source, storage_key, external_url,
                       drive_file_id, mime, size_bytes, duration_ms, status, position, created_by, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  video,
  workspace,
  project,
  "Ep 42 — scratch assembly (placeholder)",
  "upload",
  storageKey,
  null,
  null,
  "audio/wav",
  clipBytes.length,
  CLIP_SECONDS * 1000,
  "ready",
  0,
  ada,
  ago(60 * 25),
);

/** 8 kHz 8-bit mono PCM — a slow drifting tone, so the scrubber has something real to move over. */
function renderScratchTrack(seconds, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const buf = Buffer.alloc(44 + samples);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM header size
  buf.writeUInt16LE(1, 20); // format: PCM
  buf.writeUInt16LE(1, 22); // channels
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(samples, 40);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = 0.35 + 0.35 * Math.sin(t * 0.21);
    const hz = 170 + 45 * Math.sin(t * 0.08);
    buf[44 + i] = 128 + Math.round(Math.sin(2 * Math.PI * hz * t) * 30 * envelope);
  }
  return buf;
}

// ── Voice notes + transcripts ───────────────────────────────────────────────

const NOTES = [
  {
    anchor: 12_000,
    at: ago(120),
    text: "Okay so right at the start here, cut this whole intro ramble — it drags and nobody needs it. Jump straight to me walking into the room. And make sure the captions are burned in this time, the last one went out without them.",
    segments: [
      [0, 4200, "Okay so right at the start here, cut this whole intro ramble —"],
      [4200, 7100, "it drags and nobody needs it."],
      [7100, 10_400, "Jump straight to me walking into the room."],
      [10_400, 15_800, "And make sure the captions are burned in this time, the last one went out without them."],
    ],
  },
  {
    anchor: 96_000,
    at: ago(96),
    text: "At one thirty-eight put a whoosh transition into the b-roll of the desk build, and punch in slightly when I say 'this is the bit everyone gets wrong'.",
    segments: [
      [0, 5100, "At one thirty-eight put a whoosh transition into the b-roll of the desk build,"],
      [5100, 11_300, "and punch in slightly when I say 'this is the bit everyone gets wrong'."],
    ],
  },
  {
    anchor: 240_000,
    at: ago(44),
    text: "Around four minutes the colour goes really warm because the lamp is on — pull that back to match the rest of the video. Also blur the parcel on the shelf, my address is on it. Maybe add some low lo-fi under this section if you have time.",
    segments: [
      [0, 6400, "Around four minutes the colour goes really warm because the lamp is on —"],
      [6400, 9800, "pull that back to match the rest of the video."],
      [9800, 14_100, "Also blur the parcel on the shelf, my address is on it."],
      [14_100, 19_600, "Maybe add some low lo-fi under this section if you have time."],
    ],
  },
];

const noteIds = [];
for (const note of NOTES) {
  const noteId = id("not");
  noteIds.push(noteId);
  insert(
    `INSERT INTO notes (id, workspace_id, project_id, video_id, author_id, kind, audio_key, audio_ms,
                        text, anchor_ms, transcribe_status, stt_provider, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    noteId,
    workspace,
    project,
    video,
    ada,
    "voice",
    null,
    note.segments[note.segments.length - 1][1],
    note.text,
    note.anchor,
    "done",
    "seed:example",
    note.at,
  );
  note.segments.forEach(([start, end, text], index) => {
    insert(
      "INSERT INTO transcript_segments (id, workspace_id, note_id, idx, start_ms, end_ms, text, confidence) VALUES (?,?,?,?,?,?,?,?)",
      id("seg"),
      workspace,
      noteId,
      index,
      start,
      end,
      text,
      0.94,
    );
  });
}

// ── The cut list those notes produce ────────────────────────────────────────

const LABELS = [
  [0, "cut", "Cut the intro ramble", "Straight into Ada walking into the room. The talking before that goes entirely.", 8000, null, "high", "done"],
  [0, "caption", "Burn in styled captions across the whole cut", "Last episode shipped without them. Inter Semibold, #D6F55E on 60% black per the brief.", 0, null, "high", "doing"],
  [1, "transition", "Whoosh transition into the desk-build b-roll", "At 1:38, going into the b-roll from the 'Studio build' Drive folder.", 98_000, null, "normal", "open"],
  [1, "zoom", "Punch in on 'this is the bit everyone gets wrong'", "Subtle — the brief says no zoom in the intro, but this is mid-video and the line carries the section.", 101_000, 106_000, "normal", "open"],
  [2, "color", "Pull back the warm cast from the practical lamp", "Around 4:00 the desk lamp pushes everything orange. Match it to the rest of the timeline.", 240_000, 268_000, "normal", "open"],
  [2, "blur", "Blur the parcel on the shelf", "Ada's home address is legible on it. This one is non-negotiable.", 244_000, null, "high", "open"],
  [2, "music", "Low lo-fi bed under this section", "Marked optional — 'if you have time'. Epidemic Sound, nothing under the talking.", 240_000, null, "low", "open"],
];

for (const [noteIndex, type, title, detail, start, end, priority, status] of LABELS) {
  insert(
    `INSERT INTO labels (id, workspace_id, project_id, video_id, note_id, type, title, detail,
                         start_ms, end_ms, priority, status, confidence, origin, assignee_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id("lab"),
    workspace,
    project,
    video,
    noteIds[noteIndex],
    type,
    title,
    detail,
    start,
    end,
    priority,
    status,
    0.88,
    "ai",
    status === "open" ? null : theo,
    NOTES[noteIndex].at + 4000,
    NOTES[noteIndex].at + 4000,
  );
}

// ── The room ────────────────────────────────────────────────────────────────

const CHAT = [
  [theo, "text", "Got the brief, thanks — the 'must keep' on the shelf collapse is helpful, I'd have trimmed it.", ago(90)],
  [ada, "text", "Ha, that's the entire reason the video exists. Leave every frame of it.", ago(88)],
  [theo, "text", "On the punch-in at 1:41 — how hard? Brief says no zooms in the intro so I don't want to overdo it elsewhere.", ago(40)],
  [ada, "text", "Gentle. 10% over about half a second, ease out. Same as ep 39.", ago(36)],
  [theo, "text", "Perfect. Colour pass and the blur are done first, I'll push a v1 tomorrow morning.", ago(34)],
];

for (const [author, kind, bodyText, at] of CHAT) {
  insert(
    "INSERT INTO messages (id, workspace_id, project_id, author_id, kind, body, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id("msg"),
    workspace,
    project,
    author,
    kind,
    bodyText,
    null,
    at,
  );
}

const ACTIVITY = [
  ["project.created", "Ep. 42 — Building a studio in a spare room created", ago(60 * 26)],
  ["brief.updated", "Brief for Ep. 42 is 100% complete", ago(60 * 25)],
  ["video.added", "Ep 42 — scratch assembly attached", ago(60 * 25)],
  ["note.recorded", "Ada Okafor recorded a note on Ep. 42", ago(120)],
  ["labels.extracted", "2 instructions extracted from a note", ago(119)],
  ["note.recorded", "Ada Okafor recorded a note on Ep. 42", ago(96)],
  ["note.recorded", "Ada Okafor recorded a note on Ep. 42", ago(44)],
  ["labels.extracted", "3 instructions extracted from a note", ago(43)],
];

for (const [verb, summary, at] of ACTIVITY) {
  insert(
    "INSERT INTO activity (id, workspace_id, project_id, actor_id, verb, summary, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id("act"),
    workspace,
    project,
    ada,
    verb,
    summary,
    null,
    at,
  );
}

console.log(`
Seeded the "Northlight" workspace.

  Creator   ada@cutlist.local    ${PASSWORD}
  Editor    theo@cutlist.local   ${PASSWORD}

Sign in as either — the editor sees a read-only brief and a working cut list.
The attached clip is a generated five-minute placeholder so the player and the
timeline are live straight away. Delete it and upload real footage.
`);
