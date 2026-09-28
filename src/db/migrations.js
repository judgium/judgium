/** Ordered schema changes for databases that already exist.
 *
 *  schema.sql is all CREATE ... IF NOT EXISTS, so it can only ever create
 *  things that are missing - it silently does nothing when a table is present
 *  but out of date. Anything that alters an existing table therefore has to
 *  live here, where it is applied once and recorded in schema_migrations.
 *
 *  Rules for adding one:
 *    - append, never reorder or rewrite an id that has shipped;
 *    - make `up` idempotent anyway (use hasColumn/hasTable), so a database
 *      that was hand-patched or created from a newer schema.sql is unharmed;
 *    - keep it synchronous - better-sqlite3 is synchronous and the whole list
 *      runs inside one transaction.
 */

export function hasTable(db, table) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
}

export function hasColumn(db, table, column) {
  if (!hasTable(db, table)) return false;
  // PRAGMA cannot be parameterised; table names here are all literals below.
  return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

function addColumn(db, table, column, definition) {
  if (hasColumn(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

export const migrations = [
  {
    // Turns the flat organizer table into a role-aware one so the platform can
    // have administrators above individual tenants.
    id: '001_user_roles',
    up(db) {
      addColumn(db, 'users', 'role', `TEXT NOT NULL DEFAULT 'organizer'`);
      addColumn(db, 'users', 'status', `TEXT NOT NULL DEFAULT 'active'`);
      addColumn(db, 'users', 'last_login_at', 'TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
      // Rows that predate the columns get the defaults explicitly; a NULL role
      // would otherwise fail every `role = 'organizer'` comparison.
      db.exec(`UPDATE users SET role = 'organizer' WHERE role IS NULL OR role = ''`);
      db.exec(`UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''`);
    },
  },
  {
    // Platform-administrator actions are privileged and cross-tenant, so they
    // are recorded rather than trusted.
    id: '002_audit_log',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id           TEXT PRIMARY KEY,
          actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
          actor_email  TEXT NOT NULL DEFAULT '',
          action       TEXT NOT NULL,
          target_type  TEXT NOT NULL DEFAULT '',
          target_id    TEXT NOT NULL DEFAULT '',
          target_label TEXT NOT NULL DEFAULT '',
          detail       TEXT NOT NULL DEFAULT '',
          ip           TEXT NOT NULL DEFAULT '',
          created_at   TEXT NOT NULL
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)');
      // audit_log shipped in schema.sql without target_label at one point.
      addColumn(db, 'audit_log', 'target_label', `TEXT NOT NULL DEFAULT ''`);
    },
  },
];

/**
 * Applies every migration the database has not seen yet, in order, inside one
 * transaction so a failure leaves the schema exactly as it was.
 *
 * Returns the ids that were applied by this call.
 */
export function runMigrations(db, list = migrations) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const seen = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
  const pending = list.filter((migration) => !seen.has(migration.id));
  if (pending.length === 0) return [];

  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  const applyAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      record.run(migration.id, new Date().toISOString());
    }
  });
  applyAll();

  return pending.map((migration) => migration.id);
}

/** Latest applied migration id, for the platform-admin overview. */
export function schemaVersion(db) {
  if (!hasTable(db, 'schema_migrations')) return null;
  return db.prepare('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1').get()?.id ?? null;
}
