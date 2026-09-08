/**
 * Cutlist schema.
 *
 * Isolation model
 * ───────────────
 * Every tenant-owned row carries `workspace_id`, even when it could be derived
 * through a join. That redundancy is deliberate: it lets every read path apply a
 * single, uniform `WHERE workspace_id = ?` predicate, so a missing join
 * condition can never leak another workspace's rows. `src/lib/tenancy.ts` is the
 * only place allowed to produce that predicate.
 */

export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_init",
    sql: /* sql */ `
      CREATE TABLE users (
        id             TEXT PRIMARY KEY,
        email          TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        password_hash  TEXT NOT NULL,
        accent         TEXT NOT NULL DEFAULT 'lime',
        created_at     INTEGER NOT NULL
      );

      CREATE TABLE workspaces (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        slug        TEXT NOT NULL UNIQUE,
        owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE memberships (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role          TEXT NOT NULL CHECK (role IN ('owner','creator','editor','viewer')),
        created_at    INTEGER NOT NULL,
        UNIQUE (workspace_id, user_id)
      );
      CREATE INDEX idx_memberships_user ON memberships(user_id);

      CREATE TABLE invites (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        email         TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('creator','editor','viewer')),
        token         TEXT NOT NULL UNIQUE,
        invited_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    INTEGER NOT NULL,
        accepted_at   INTEGER
      );

      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE projects (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        summary       TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'briefing'
                        CHECK (status IN ('briefing','editing','review','delivered','archived')),
        due_at        INTEGER,
        created_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_projects_ws ON projects(workspace_id, updated_at DESC);

      -- The creator's structured brief. One per project.
      CREATE TABLE briefs (
        project_id    TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        payload       TEXT NOT NULL DEFAULT '{}',
        completeness  INTEGER NOT NULL DEFAULT 0,
        updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE videos (
        id             TEXT PRIMARY KEY,
        workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title          TEXT NOT NULL,
        source         TEXT NOT NULL CHECK (source IN ('upload','drive','link')),
        storage_key    TEXT,
        external_url   TEXT,
        drive_file_id  TEXT,
        mime           TEXT NOT NULL DEFAULT 'video/mp4',
        size_bytes     INTEGER NOT NULL DEFAULT 0,
        duration_ms    INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'ready'
                         CHECK (status IN ('ready','processing','failed')),
        position       INTEGER NOT NULL DEFAULT 0,
        created_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX idx_videos_project ON videos(project_id, position);

      -- A note is one instruction from the creator, anchored to a timestamp.
      -- kind='voice' notes carry audio + transcript; kind='text' are typed.
      CREATE TABLE notes (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        video_id      TEXT REFERENCES videos(id) ON DELETE CASCADE,
        author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (kind IN ('voice','text')),
        audio_key     TEXT,
        audio_ms      INTEGER NOT NULL DEFAULT 0,
        text          TEXT NOT NULL DEFAULT '',
        anchor_ms     INTEGER NOT NULL DEFAULT 0,
        transcribe_status TEXT NOT NULL DEFAULT 'none'
                        CHECK (transcribe_status IN ('none','queued','running','done','failed')),
        transcribe_error  TEXT,
        stt_provider  TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_notes_video ON notes(video_id, anchor_ms);
      CREATE INDEX idx_notes_project ON notes(project_id, created_at DESC);

      -- Word/phrase level output from the STT provider.
      CREATE TABLE transcript_segments (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        idx           INTEGER NOT NULL,
        start_ms      INTEGER NOT NULL,
        end_ms        INTEGER NOT NULL,
        text          TEXT NOT NULL,
        confidence    REAL NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_segments_note ON transcript_segments(note_id, idx);

      -- The actual edit instructions: what the editor works from.
      CREATE TABLE labels (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        video_id      TEXT REFERENCES videos(id) ON DELETE CASCADE,
        note_id       TEXT REFERENCES notes(id) ON DELETE CASCADE,
        type          TEXT NOT NULL,
        title         TEXT NOT NULL,
        detail        TEXT NOT NULL DEFAULT '',
        start_ms      INTEGER NOT NULL DEFAULT 0,
        end_ms        INTEGER,
        priority      TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high')),
        status        TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','doing','done','skipped')),
        confidence    REAL NOT NULL DEFAULT 0.5,
        origin        TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai','manual','heuristic')),
        assignee_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_labels_video ON labels(video_id, start_ms);
      CREATE INDEX idx_labels_project ON labels(project_id, status);

      CREATE TABLE messages (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        author_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
        kind          TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system','ai')),
        body          TEXT NOT NULL,
        meta          TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_project ON messages(project_id, created_at);

      CREATE TABLE suggestions (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        video_id      TEXT REFERENCES videos(id) ON DELETE CASCADE,
        payload       TEXT NOT NULL,
        model         TEXT NOT NULL DEFAULT 'heuristic',
        created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_suggestions_project ON suggestions(project_id, created_at DESC);

      -- Encrypted per-workspace provider credentials. Never leaves the server.
      CREATE TABLE workspace_secrets (
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        key           TEXT NOT NULL,
        value_enc     TEXT NOT NULL,
        hint          TEXT NOT NULL DEFAULT '',
        updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, key)
      );

      CREATE TABLE workspace_settings (
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        key           TEXT NOT NULL,
        value         TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key)
      );

      CREATE TABLE integrations (
        id             TEXT PRIMARY KEY,
        workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider       TEXT NOT NULL,
        account_email  TEXT NOT NULL DEFAULT '',
        access_enc     TEXT,
        refresh_enc    TEXT,
        expires_at     INTEGER NOT NULL DEFAULT 0,
        scope          TEXT NOT NULL DEFAULT '',
        connected_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at     INTEGER NOT NULL,
        UNIQUE (workspace_id, provider)
      );

      CREATE TABLE activity (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
        actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
        verb          TEXT NOT NULL,
        summary       TEXT NOT NULL,
        meta          TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_activity_ws ON activity(workspace_id, created_at DESC);
    `,
  },
];
