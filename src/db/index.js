import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { runMigrations, schemaVersion } from './migrations.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function openDatabase(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);

  // WAL lets the leaderboard readers run while judges are writing scores.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Wait rather than throw SQLITE_BUSY when two writes collide.
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -16000'); // ~16 MB page cache

  // schema.sql creates whatever is missing; migrations.js updates whatever is
  // present but out of date. Both run on every boot and both are idempotent.
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  const applied = runMigrations(db);
  if (applied.length > 0) {
    console.log(`[db] applied ${applied.length} migration(s): ${applied.join(', ')}`);
  }

  return db;
}

let instance = null;

export function getDb() {
  if (!instance) instance = openDatabase();
  return instance;
}

export function closeDb() {
  if (instance) {
    try {
      instance.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* best effort */
    }
    instance.close();
    instance = null;
  }
}

/** Fold the WAL back into the main file so a file-level copy is complete. */
export function checkpoint(db = getDb()) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a consistent snapshot to `destination` using VACUUM INTO, which runs
 * inside a read transaction - safe to call on a live database with judges
 * mid-scoring, unlike copying the .db file out from under an open WAL.
 */
export function backupTo(destination, db = getDb()) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    throw new Error(`Backup target already exists: ${destination}`);
  }
  // VACUUM INTO cannot be parameterised; quote by doubling single quotes.
  db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  return { path: destination, bytes: fs.statSync(destination).size };
}

/** Size on disk of the database plus its WAL and shared-memory sidecars. */
export function databaseBytes(dbPath = config.dbPath) {
  if (dbPath === ':memory:') return 0;
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += fs.statSync(`${dbPath}${suffix}`).size;
    } catch {
      /* sidecar absent after a checkpoint - not an error */
    }
  }
  return total;
}

export { schemaVersion };
