import { config } from '../config.js';
import { databaseBytes, schemaVersion } from '../db/index.js';

/**
 * Promotes the accounts named in SUPERADMIN_EMAILS.
 *
 * This is the only way to create the first platform administrator: there is no
 * self-service route to the role, and a fresh deployment has nobody who could
 * grant it. Run at boot and on sign-up, so listing an address works whether
 * the account already exists or is created later.
 */
export function bootstrapSuperadmins(db, emails = config.superadminEmails) {
  if (emails.length === 0) return [];
  const promote = db.prepare(
    `UPDATE users SET role = 'superadmin' WHERE email = ? AND role <> 'superadmin'`,
  );
  const promoted = [];
  for (const email of emails) {
    if (promote.run(email).changes > 0) promoted.push(email);
  }
  return promoted;
}

export function countSuperadmins(db, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? `SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND status = 'active'`
    : `SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'`;
  return db.prepare(sql).get().n;
}

/** Cross-tenant counters for the platform dashboard. */
export function platformOverview(db) {
  const users = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN role = 'superadmin' THEN 1 ELSE 0 END) AS superadmins,
              SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
              SUM(CASE WHEN last_login_at IS NOT NULL THEN 1 ELSE 0 END) AS everSignedIn
         FROM users`,
    )
    .get();

  const competitions = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'draft'  THEN 1 ELSE 0 END) AS draft,
              SUM(CASE WHEN status = 'live'   THEN 1 ELSE 0 END) AS live,
              SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
         FROM competitions`,
    )
    .get();

  const one = (sql) => db.prepare(sql).get().n;

  return {
    users: {
      total: users.total ?? 0,
      superadmins: users.superadmins ?? 0,
      suspended: users.suspended ?? 0,
      everSignedIn: users.everSignedIn ?? 0,
    },
    competitions: {
      total: competitions.total ?? 0,
      draft: competitions.draft ?? 0,
      live: competitions.live ?? 0,
      closed: competitions.closed ?? 0,
    },
    content: {
      entries: one('SELECT COUNT(*) AS n FROM entries'),
      judges: one('SELECT COUNT(*) AS n FROM judges'),
      scores: one('SELECT COUNT(*) AS n FROM scores'),
      criteria: one('SELECT COUNT(*) AS n FROM criteria'),
    },
    storage: {
      // The two facts that decide whether data survives a restart, surfaced
      // where an operator will actually look at them.
      dbPath: config.dbPath,
      dbBytes: databaseBytes(),
      schemaVersion: schemaVersion(db),
      sessionSecretSource: config.sessionSecretSource,
      sessionsSurviveRestart: config.sessionSecretSource !== 'ephemeral',
      backupDir: config.backupDir,
    },
  };
}
