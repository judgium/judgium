/** Boot-time environment plumbing: .env loading and a durable session key.
 *
 *  Imported by config.js before it snapshots process.env, so everything here
 *  runs earlier than any other application code.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Reads .env into process.env so DATABASE_PATH and SESSION_SECRET no longer
 * have to be exported by hand on every start. Variables already present in the
 * real environment win, matching Node's own --env-file behaviour, which keeps
 * the test harness and Azure's app settings authoritative over a stray .env.
 *
 * Returns the file that was loaded, or null when there is none - having no
 * .env is the normal case in CI and in production.
 */
export function loadDotEnv(file = process.env.ENV_FILE || path.join(projectRoot, '.env')) {
  try {
    process.loadEnvFile(file);
    return file;
  } catch {
    return null;
  }
}

const SECRET_FILE = 'session-secret';

/**
 * Resolves the key used to sign organizer session cookies, preferring an
 * explicit SESSION_SECRET and otherwise persisting a generated one next to the
 * database.
 *
 * This exists because an unset SESSION_SECRET used to mean a fresh random key
 * on every boot: the accounts and competitions were still safely in SQLite, but
 * every session cookie stopped verifying, so a restart dropped you back on the
 * sign-in page and looked exactly like the whole account had been wiped.
 * Storing the key beside the data gives it the same lifetime as the data it
 * protects, so restarts are no longer visible to signed-in organizers.
 */
export function resolveSessionSecret(dataDir) {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return { secret: fromEnv, source: 'env', path: null };

  const file = path.join(dataDir, SECRET_FILE);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return { secret: existing, source: 'file', path: file };
  } catch {
    /* not written yet, or unreadable - fall through and try to create it */
  }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    // 0600: the key is as sensitive as the database it sits next to. `wx` so
    // two workers racing on first boot cannot clobber each other's key.
    fs.writeFileSync(file, `${generated}\n`, { mode: 0o600, flag: 'wx' });
    return { secret: generated, source: 'file', path: file };
  } catch (err) {
    if (err?.code === 'EEXIST') {
      // Lost the race; the winner's key is the one that counts.
      try {
        const existing = fs.readFileSync(file, 'utf8').trim();
        if (existing.length >= 32) return { secret: existing, source: 'file', path: file };
      } catch {
        /* fall through to ephemeral */
      }
    }
    // Read-only filesystem: still boot, but sessions will not outlive the
    // process and config.js warns about it.
    return { secret: generated, source: 'ephemeral', path: null };
  }
}
