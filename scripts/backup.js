#!/usr/bin/env node
/**
 * Writes a consistent snapshot of the database:
 *
 *   npm run backup
 *   npm run backup -- /path/to/snapshot.db
 *
 * Uses SQLite's VACUUM INTO, which runs in a read transaction, so it is safe
 * against a live instance with judges mid-scoring. Copying judgium.db by hand
 * while the WAL is open is not - you can get a snapshot missing the newest
 * scores, or a torn one.
 */
import path from 'node:path';
import { backupTo, checkpoint, closeDb, databaseBytes, getDb } from '../src/db/index.js';
import { config } from '../src/config.js';

const explicit = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.resolve(explicit || path.join(config.backupDir, `judgium-${stamp}.db`));

const db = getDb();
try {
  console.log(`source ${config.dbPath} (${(databaseBytes() / 1024).toFixed(0)} KB)`);
  checkpoint(db);
  const result = backupTo(target, db);
  console.log(`backup ${result.path} (${(result.bytes / 1024).toFixed(0)} KB)`);
  console.log('\nRestore with the server stopped:');
  console.log(`  cp "${result.path}" "${config.dbPath}"`);
  console.log(`  rm -f "${config.dbPath}-wal" "${config.dbPath}-shm"`);
} catch (err) {
  console.error(`backup failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
