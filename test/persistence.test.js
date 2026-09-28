/** Durability of everything that has to outlive a restart: the schema, the
 *  rows, and the key that keeps organizers signed in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { hasColumn, migrations, runMigrations, schemaVersion } from '../src/db/migrations.js';
import { resolveSessionSecret } from '../src/lib/env.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'judgium-persist-'));
const schemaSql = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

/** A database as it looked before roles existed: users with no role column. */
function legacyDatabase(dir) {
  const db = new Database(path.join(dir, 'legacy.db'));
  db.exec(`
    CREATE TABLE users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      locale        TEXT NOT NULL DEFAULT 'en',
      created_at    TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, locale, created_at)
     VALUES ('u_old', 'old@example.com', 'Existing Organizer', 'x', 'ja', '2026-01-01T00:00:00.000Z')`,
  ).run();
  return db;
}

test('a database created before roles existed gains them without losing rows', () => {
  const dir = tmp();
  const db = legacyDatabase(dir);
  try {
    assert.equal(hasColumn(db, 'users', 'role'), false, 'precondition: the legacy schema has no role');

    // Exactly what openDatabase does: the baseline first, then migrations.
    db.exec(schemaSql);
    const applied = runMigrations(db);

    assert.ok(applied.includes('001_user_roles'));
    assert.equal(hasColumn(db, 'users', 'role'), true);
    assert.equal(hasColumn(db, 'users', 'status'), true);
    assert.equal(hasColumn(db, 'users', 'last_login_at'), true);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get('u_old');
    assert.equal(user.email, 'old@example.com', 'the existing account is still there');
    assert.equal(user.locale, 'ja', 'and its settings are untouched');
    assert.equal(user.role, 'organizer', 'existing accounts default to organizer, never superadmin');
    assert.equal(user.status, 'active');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations are recorded, so a second boot applies nothing', () => {
  const dir = tmp();
  const db = new Database(path.join(dir, 'fresh.db'));
  try {
    db.exec(schemaSql);
    const first = runMigrations(db);
    assert.equal(first.length, migrations.length, 'a fresh database records every migration');

    const second = runMigrations(db);
    assert.deepEqual(second, [], 'nothing is re-applied');
    assert.equal(schemaVersion(db), migrations.at(-1).id);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a migration that throws leaves the schema exactly as it was', () => {
  const dir = tmp();
  const db = new Database(path.join(dir, 'rollback.db'));
  try {
    db.exec(schemaSql);
    runMigrations(db);

    const bad = [
      {
        id: '999_adds_then_fails',
        up(d) {
          d.exec('CREATE TABLE half_done (id TEXT)');
          throw new Error('boom');
        },
      },
    ];
    assert.throws(() => runMigrations(db, bad), /boom/);

    const exists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'half_done'`)
      .get();
    assert.equal(exists, undefined, 'the partial change was rolled back');
    const recorded = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get('999_adds_then_fails');
    assert.equal(recorded, undefined, 'and it is not marked as applied, so it will be retried');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the session key is generated once and then reused, so restarts keep organizers signed in', () => {
  const dir = tmp();
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const first = resolveSessionSecret(dir);
    assert.equal(first.source, 'file');
    assert.ok(first.secret.length >= 32);

    // Stands in for the next process start against the same data directory.
    const second = resolveSessionSecret(dir);
    assert.equal(second.source, 'file');
    assert.equal(second.secret, first.secret, 'the same key comes back, so existing cookies still verify');

    const mode = fs.statSync(path.join(dir, 'session-secret')).mode & 0o777;
    assert.equal(mode, 0o600, 'the key is no more readable than the database beside it');
  } finally {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit SESSION_SECRET wins and is never written to disk', () => {
  const dir = tmp();
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'an-explicitly-configured-secret-value';
  try {
    const result = resolveSessionSecret(dir);
    assert.equal(result.source, 'env');
    assert.equal(result.secret, 'an-explicitly-configured-secret-value');
    assert.equal(fs.existsSync(path.join(dir, 'session-secret')), false);
  } finally {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a read-only data directory degrades to a per-process key rather than failing to boot', () => {
  const dir = tmp();
  const locked = path.join(dir, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o500); // r-x: readable, not writable
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const result = resolveSessionSecret(locked);
    assert.equal(result.source, 'ephemeral', 'the caller can warn about it');
    assert.ok(result.secret.length >= 32, 'but the app still has a usable key');
  } finally {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    fs.chmodSync(locked, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a backup is a complete, independently readable copy', async () => {
  const dir = tmp();
  process.env.DATABASE_PATH = path.join(dir, 'backup-source.db');
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-secret-'.repeat(4);
  try {
    // Fresh module registry so db/index.js picks up this DATABASE_PATH.
    const { backupTo, closeDb, getDb } = await import(`../src/db/index.js?backup=${Date.now()}`);
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, locale, role, status, created_at)
       VALUES ('u_b', 'backup@example.com', 'B', 'x', 'en', 'superadmin', 'active', '2026-01-01T00:00:00.000Z')`,
    ).run();

    const target = path.join(dir, 'snapshot.db');
    const result = backupTo(target, db);
    assert.ok(result.bytes > 0);

    const copy = new Database(target, { readonly: true });
    const row = copy.prepare('SELECT email, role FROM users WHERE id = ?').get('u_b');
    copy.close();
    assert.deepEqual(row, { email: 'backup@example.com', role: 'superadmin' });

    assert.throws(() => backupTo(target, db), /already exists/, 'an existing snapshot is never overwritten');
    closeDb();
  } finally {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    delete process.env.DATABASE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
