-- Judgium schema. Applied idempotently at boot.
--
-- This file is the baseline for a *fresh* database only: every statement is
-- CREATE ... IF NOT EXISTS, so editing a table here does nothing to a database
-- that already exists. Changes to existing tables belong in migrations.js,
-- which runs straight after this file and is tracked in schema_migrations.

-- Ordered, once-only schema changes. Written by migrations.js.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en',
  -- organizer | participant | superadmin
  role          TEXT NOT NULL DEFAULT 'organizer',
  -- active | suspended. Suspended accounts keep their data but cannot sign in.
  status        TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at    TEXT NOT NULL
);
-- No index on users(role) here on purpose: this file also runs against a
-- database whose `users` predates the column, and CREATE INDEX would fail on
-- it before migration 001 has had a chance to add it. Migration 001 creates
-- the index, for old and new databases alike.

-- Append-only record of platform-administrator actions. Deliberately outlives
-- the accounts it refers to, so actor_id goes NULL rather than cascading.
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  target_label TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS competitions (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  public_slug          TEXT NOT NULL UNIQUE,
  -- draft | live | closed
  status               TEXT NOT NULL DEFAULT 'draft',
  -- points: raw criterion points are summed.
  -- weighted: each criterion contributes (score / max) * weight, out of 100.
  scoring_mode         TEXT NOT NULL DEFAULT 'points',
  -- avg | sum  (how per-judge totals combine into the entry score)
  aggregate            TEXT NOT NULL DEFAULT 'avg',
  drop_high_low        INTEGER NOT NULL DEFAULT 0,
  public_board         INTEGER NOT NULL DEFAULT 1,
  show_scores_on_board INTEGER NOT NULL DEFAULT 1,
  allow_notes          INTEGER NOT NULL DEFAULT 1,
  allow_decimals       INTEGER NOT NULL DEFAULT 1,
  -- 1 while participants may add and edit their own entries at /enter/<slug>.
  -- Off by default: a competition accepts submissions only once its organizer
  -- says so, and turning it off is the deadline.
  submissions_open     INTEGER NOT NULL DEFAULT 0,
  -- bumped on every change that can affect a leaderboard; drives cache busting
  rev                  INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_competitions_owner ON competitions(owner_id);

CREATE TABLE IF NOT EXISTS tracks (
  id             TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_comp ON tracks(competition_id, sort_order);

CREATE TABLE IF NOT EXISTS criteria (
  id             TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  -- NULL = applies to every track
  track_id       TEXT REFERENCES tracks(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  max_score      REAL NOT NULL DEFAULT 10,
  weight         REAL NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_criteria_comp ON criteria(competition_id, sort_order);

CREATE TABLE IF NOT EXISTS entries (
  id             TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  track_id       TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  team_name      TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  project_url    TEXT NOT NULL DEFAULT '',
  video_url      TEXT NOT NULL DEFAULT '',
  table_label    TEXT NOT NULL DEFAULT '',
  -- The participant who submitted this entry, or NULL when an organizer
  -- created it. Set to NULL rather than cascading on account deletion, so the
  -- entry and its scores survive the submitter leaving.
  submitted_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_comp ON entries(competition_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_entries_track ON entries(track_id);

CREATE TABLE IF NOT EXISTS judges (
  id             TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL DEFAULT '',
  token          TEXT NOT NULL UNIQUE,
  locale         TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  completed_at   TEXT,
  last_seen_at   TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_judges_comp ON judges(competition_id, sort_order);

-- Optional narrowing: if a judge has no rows here they score every track.
CREATE TABLE IF NOT EXISTS judge_tracks (
  judge_id TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (judge_id, track_id)
);

CREATE TABLE IF NOT EXISTS scores (
  judge_id     TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  entry_id     TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
  value        REAL NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (judge_id, entry_id, criterion_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_scores_entry ON scores(entry_id);
CREATE INDEX IF NOT EXISTS idx_scores_judge ON scores(judge_id);

CREATE TABLE IF NOT EXISTS notes (
  judge_id   TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (judge_id, entry_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_notes_entry ON notes(entry_id);
