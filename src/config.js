import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { loadDotEnv, resolveSessionSecret } from './lib/env.js';

// Must happen before anything below reads process.env.
const envFile = loadDotEnv();

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback = false) {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Capacity is derived from the host rather than hard-coded, so the same build
 * behaves sensibly on a laptop, a B1 App Service plan and a P2v3 alike.
 *
 * An idle SSE subscriber costs roughly a socket plus a few KB of heap, so the
 * ceiling is driven by memory; the CPU count caps how many we can actually
 * serve broadcasts to without falling behind.
 */
function autoCapacity() {
  const cpus = Math.max(1, os.cpus()?.length ?? 1);
  const totalMemGb = os.totalmem() / 1024 ** 3;
  // Respect a container memory limit when one is visible (cgroup v2).
  let limitGb = totalMemGb;
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (raw && raw !== 'max') {
      const bytes = Number(raw);
      if (Number.isFinite(bytes) && bytes > 0) limitGb = Math.min(limitGb, bytes / 1024 ** 3);
    }
  } catch {
    /* not containerised, or cgroup v1 - fall back to totalmem */
  }

  const byMemory = Math.round(limitGb * 600);
  const byCpu = cpus * 800;
  const maxLiveClients = clamp(Math.min(byMemory, byCpu), 50, 20000);

  return {
    cpus,
    memoryGb: Math.round(limitGb * 100) / 100,
    maxLiveClients,
    // Read endpoints are cheap and cached; writes touch SQLite.
    rateLimitRead: clamp(cpus * 900, 600, 20000),
    rateLimitWrite: clamp(cpus * 300, 240, 6000),
    // Coalesce leaderboard recomputes. More judges -> more score writes, so
    // scale the floor with how much CPU we have to spend on recomputing.
    leaderboardThrottleMs: clamp(Math.round(1200 / cpus), 150, 1200),
  };
}

const auto = autoCapacity();

const dbPath = path.resolve(process.env.DATABASE_PATH?.trim() || './data/judgium.db');
// Everything durable lives together: the database, its WAL, the session key
// and backup snapshots. Persist this one directory and nothing is lost.
const dataDir = path.dirname(dbPath);
const backupDir = path.resolve(process.env.BACKUP_DIR?.trim() || path.join(dataDir, 'backups'));

const session = resolveSessionSecret(dataDir);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num('PORT', 3000),
  envFile,
  dbPath,
  dataDir,
  backupDir,
  sessionSecret: session.secret,
  // 'env' | 'file' | 'ephemeral' - only 'ephemeral' loses sessions on restart.
  sessionSecretSource: session.source,
  sessionSecretPath: session.path,
  ephemeralSecret: session.source === 'ephemeral',
  sessionTtlMs: num('SESSION_TTL_HOURS', 24 * 14) * 3600 * 1000,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  // AGPL-3.0 section 13: anyone interacting with this program over a network
  // must be offered its complete corresponding source. Every page footer links
  // to /source, which redirects here, so an operator running a modified build
  // points SOURCE_URL at their own repository and complies by configuration
  // rather than by editing five HTML files. Left unset it names the upstream
  // project, which is only correct for an unmodified build.
  sourceUrl: (process.env.SOURCE_URL || 'https://github.com/judgium/judgium').replace(/\/+$/, ''),

  disableSignup: bool('DISABLE_SIGNUP', false),
  signupAllowlist: (process.env.SIGNUP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Accounts promoted to platform administrator at boot. This is the only way
  // to mint the first superadmin; afterwards they manage each other in the UI.
  superadminEmails: (process.env.SUPERADMIN_EMAILS || process.env.SUPERADMIN_EMAIL || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  capacity: {
    detectedCpus: auto.cpus,
    detectedMemoryGb: auto.memoryGb,
    maxLiveClients: Math.round(num('MAX_LIVE_CLIENTS', auto.maxLiveClients)),
    rateLimitRead: Math.round(num('RATE_LIMIT_READ', auto.rateLimitRead)),
    rateLimitWrite: Math.round(num('RATE_LIMIT_WRITE', auto.rateLimitWrite)),
    leaderboardThrottleMs: Math.round(num('LEADERBOARD_THROTTLE_MS', auto.leaderboardThrottleMs)),
    leaderboardMaxRows: Math.round(num('LEADERBOARD_MAX_ROWS', 0)),
    // Guard rails on request bodies; entry/judge counts themselves are unlimited.
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
    bulkImportMaxLines: Math.round(num('BULK_IMPORT_MAX_LINES', 5000)),
  },

  limits: {
    notesMaxLength: 2000,
    nameMaxLength: 200,
    descriptionMaxLength: 4000,
    urlMaxLength: 500,
  },
};

export const LOCALES = ['en', 'ja', 'es', 'zh', 'ko'];
export const DEFAULT_LOCALE = 'en';

/** organizer: owns their own competitions. superadmin: owns the platform. */
export const ROLES = ['organizer', 'superadmin'];
export const DEFAULT_ROLE = 'organizer';
export const USER_STATUSES = ['active', 'suspended'];
