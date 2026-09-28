/** Cross-tenant platform administration.
 *
 *  Every other router is scoped to one organizer: competitions.js filters by
 *  owner_id, judge.js by token. This one deliberately is not - it is how the
 *  operator of a Judgium deployment sees and manages every account on it.
 *  Mounted behind requireSuperadmin, and every write is written to audit_log.
 */
import express from 'express';
import path from 'node:path';

import { ROLES, USER_STATUSES, config } from '../config.js';
import { backupTo, checkpoint, getDb } from '../db/index.js';
import { audit, recentAudit } from '../lib/audit.js';
import { hashPassword } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { hub } from '../lib/events.js';
import { noStore, wrap } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { email as vEmail, num as vNum, oneOf, str } from '../lib/validate.js';
import { bootstrapSuperadmins, countSuperadmins, platformOverview } from '../services/platform.js';
import { dropCache } from '../services/results.js';
import { requireSuperadmin } from '../middleware/session.js';

export const sysadminRouter = express.Router();
sysadminRouter.use(requireSuperadmin);

const COMPETITION_STATUSES = ['draft', 'live', 'closed'];

const adminUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  locale: row.locale,
  role: row.role,
  status: row.status,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  counts: {
    competitions: row.competition_count ?? 0,
    entries: row.entry_count ?? 0,
    judges: row.judge_count ?? 0,
  },
});

const adminCompetition = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.public_slug,
  status: row.status,
  ownerId: row.owner_id,
  ownerEmail: row.owner_email ?? '',
  ownerName: row.owner_name ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  counts: {
    entries: row.entry_count ?? 0,
    judges: row.judge_count ?? 0,
    scores: row.score_count ?? 0,
  },
});

/** Shared paging shape: ?limit=&offset=, clamped so one call cannot dump all. */
function paging(req, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = vNum(req.query.limit, 'limit', { min: 1, max: maxLimit, integer: true }) ?? defaultLimit;
  const offset = vNum(req.query.offset, 'offset', { min: 0, max: 1e7, integer: true }) ?? 0;
  return { limit, offset };
}

function loadUser(id) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) throw notFound('User not found');
  return row;
}

/**
 * Refuses a change that would leave the deployment with no way back in.
 *
 * In practice assertNotSelf already covers this through the API: the actor is
 * always an active superadmin, so any *other* active superadmin makes at least
 * two. This is the backstop for anything that ever acts without a self to
 * compare against - the CLI does, and a future service credential would too.
 */
function assertNotLastSuperadmin(db, target, { because }) {
  if (target.role !== 'superadmin' || target.status !== 'active') return;
  if (countSuperadmins(db, { activeOnly: true }) > 1) return;
  throw conflict(
    'last_superadmin',
    `This is the only active platform administrator, so it cannot be ${because}. Promote another account first.`,
  );
}

/** Self-inflicted lockout guard: role and status are not self-editable. */
function assertNotSelf(req, targetId, action) {
  if (req.user.id === targetId) {
    throw forbidden(`You cannot ${action} your own account. Ask another platform administrator.`);
  }
}

// --- overview ----------------------------------------------------------

sysadminRouter.get(
  '/overview',
  wrap((_req, res) => {
    const db = getDb();
    const overview = platformOverview(db);

    const recentUsers = db
      .prepare(
        `SELECT id, email, name, locale, role, status, last_login_at, created_at
           FROM users ORDER BY created_at DESC LIMIT 5`,
      )
      .all()
      .map(adminUser);

    const recentCompetitions = db
      .prepare(
        `SELECT c.*, u.email AS owner_email, u.name AS owner_name
           FROM competitions c LEFT JOIN users u ON u.id = c.owner_id
          ORDER BY c.updated_at DESC LIMIT 5`,
      )
      .all()
      .map(adminCompetition);

    noStore(res).json({
      ...overview,
      live: hub.stats,
      recentUsers,
      recentCompetitions,
    });
  }),
);

// --- accounts ----------------------------------------------------------

sysadminRouter.get(
  '/users',
  wrap((req, res) => {
    const db = getDb();
    const { limit, offset } = paging(req);
    const q = str(req.query.q, 'q', { max: 200 });
    const role = req.query.role ? oneOf(req.query.role, 'role', ROLES) : null;
    const status = req.query.status ? oneOf(req.query.status, 'status', USER_STATUSES) : null;

    const where = [];
    const params = {};
    if (q) {
      where.push('(u.email LIKE @like OR u.name LIKE @like)');
      params.like = `%${q}%`;
    }
    if (role) {
      where.push('u.role = @role');
      params.role = role;
    }
    if (status) {
      where.push('u.status = @status');
      params.status = status;
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM competitions c WHERE c.owner_id = u.id) AS competition_count,
                (SELECT COUNT(*) FROM entries e
                   JOIN competitions c ON c.id = e.competition_id WHERE c.owner_id = u.id) AS entry_count,
                (SELECT COUNT(*) FROM judges j
                   JOIN competitions c ON c.id = j.competition_id WHERE c.owner_id = u.id) AS judge_count
           FROM users u
           ${clause}
          ORDER BY u.created_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset });

    const total = db.prepare(`SELECT COUNT(*) AS n FROM users u ${clause}`).get(params).n;

    noStore(res).json({ users: rows.map(adminUser), total, limit, offset });
  }),
);

sysadminRouter.get(
  '/users/:id',
  wrap((req, res) => {
    const db = getDb();
    const row = loadUser(req.params.id);
    const competitions = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM entries e WHERE e.competition_id = c.id) AS entry_count,
                (SELECT COUNT(*) FROM judges  j WHERE j.competition_id = c.id) AS judge_count
           FROM competitions c WHERE c.owner_id = ? ORDER BY c.updated_at DESC`,
      )
      .all(row.id)
      .map(adminCompetition);

    noStore(res).json({ user: adminUser(row), competitions });
  }),
);

sysadminRouter.post(
  '/users',
  wrap((req, res) => {
    const db = getDb();
    const addr = vEmail(req.body?.email);
    const name = str(req.body?.name, 'name', { required: true, max: 120 });
    const password = String(req.body?.password ?? '');
    if (password.length < 10) throw badRequest('weak_password', 'Password must be at least 10 characters long');
    if (password.length > 512) throw badRequest('weak_password', 'Password is too long');
    const role = oneOf(req.body?.role, 'role', ROLES, 'organizer');

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(addr)) {
      throw conflict('email_taken', 'An account with that e-mail already exists');
    }

    const user = {
      id: newId('u_'),
      email: addr,
      name,
      password_hash: hashPassword(password),
      locale: oneOf(req.body?.locale, 'locale', ['en', 'ja', 'es', 'zh', 'ko'], 'en'),
      role,
      status: 'active',
      created_at: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, locale, role, status, created_at)
       VALUES (@id, @email, @name, @password_hash, @locale, @role, @status, @created_at)`,
    ).run(user);

    audit(req, {
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      detail: `role=${role}`,
    });
    res.status(201).json({ user: adminUser({ ...user, last_login_at: null }) });
  }),
);

sysadminRouter.patch(
  '/users/:id',
  wrap((req, res) => {
    const db = getDb();
    const target = loadUser(req.params.id);

    const changes = {};
    if (req.body?.name !== undefined) changes.name = str(req.body.name, 'name', { required: true, max: 120 });
    if (req.body?.locale !== undefined) {
      changes.locale = oneOf(req.body.locale, 'locale', ['en', 'ja', 'es', 'zh', 'ko'], target.locale);
    }

    if (req.body?.role !== undefined) {
      const role = oneOf(req.body.role, 'role', ROLES);
      if (role !== target.role) {
        assertNotSelf(req, target.id, 'change the role of');
        if (role !== 'superadmin') assertNotLastSuperadmin(db, target, { because: 'demoted' });
        changes.role = role;
      }
    }

    if (req.body?.status !== undefined) {
      const status = oneOf(req.body.status, 'status', USER_STATUSES);
      if (status !== target.status) {
        assertNotSelf(req, target.id, 'suspend');
        if (status === 'suspended') assertNotLastSuperadmin(db, target, { because: 'suspended' });
        changes.status = status;
      }
    }

    const keys = Object.keys(changes);
    if (keys.length === 0) return noStore(res).json({ user: adminUser(target) });

    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({
      ...changes,
      id: target.id,
    });

    audit(req, {
      action: 'user.update',
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.email,
      detail: keys.map((k) => `${k}: ${target[k]} -> ${changes[k]}`).join('; '),
    });

    noStore(res).json({ user: adminUser({ ...target, ...changes }) });
  }),
);

sysadminRouter.post(
  '/users/:id/password',
  wrap((req, res) => {
    const db = getDb();
    const target = loadUser(req.params.id);
    const next = String(req.body?.newPassword ?? '');
    if (next.length < 10) throw badRequest('weak_password', 'Password must be at least 10 characters long');
    if (next.length > 512) throw badRequest('weak_password', 'Password is too long');

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), target.id);
    audit(req, {
      action: 'user.password_reset',
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.email,
    });
    res.json({ ok: true });
  }),
);

sysadminRouter.delete(
  '/users/:id',
  wrap((req, res) => {
    const db = getDb();
    const target = loadUser(req.params.id);
    assertNotSelf(req, target.id, 'delete');
    assertNotLastSuperadmin(db, target, { because: 'deleted' });

    // competitions.owner_id cascades, and every competition child cascades in
    // turn, so this removes the tenant's data with it. Drop the cached
    // leaderboards and close their live streams first or viewers keep a stale
    // board open against rows that no longer exist.
    const owned = db.prepare('SELECT id FROM competitions WHERE owner_id = ?').all(target.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    for (const competition of owned) {
      dropCache(competition.id);
      hub.closeTopic(competition.id);
    }

    audit(req, {
      action: 'user.delete',
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.email,
      detail: `removed ${owned.length} competition(s)`,
    });
    res.json({ ok: true, removedCompetitions: owned.length });
  }),
);

// --- competitions across every tenant ----------------------------------

sysadminRouter.get(
  '/competitions',
  wrap((req, res) => {
    const db = getDb();
    const { limit, offset } = paging(req);
    const q = str(req.query.q, 'q', { max: 200 });
    const status = req.query.status ? oneOf(req.query.status, 'status', COMPETITION_STATUSES) : null;

    const where = [];
    const params = {};
    if (q) {
      where.push('(c.name LIKE @like OR c.public_slug LIKE @like OR u.email LIKE @like)');
      params.like = `%${q}%`;
    }
    if (status) {
      where.push('c.status = @status');
      params.status = status;
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT c.*, u.email AS owner_email, u.name AS owner_name,
                (SELECT COUNT(*) FROM entries e WHERE e.competition_id = c.id) AS entry_count,
                (SELECT COUNT(*) FROM judges  j WHERE j.competition_id = c.id) AS judge_count,
                (SELECT COUNT(*) FROM scores s
                   JOIN entries e ON e.id = s.entry_id WHERE e.competition_id = c.id) AS score_count
           FROM competitions c
           LEFT JOIN users u ON u.id = c.owner_id
           ${clause}
          ORDER BY c.updated_at DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset });

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM competitions c LEFT JOIN users u ON u.id = c.owner_id ${clause}`)
      .get(params).n;

    noStore(res).json({ competitions: rows.map(adminCompetition), total, limit, offset });
  }),
);

sysadminRouter.patch(
  '/competitions/:id',
  wrap((req, res) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM competitions WHERE id = ?').get(req.params.id);
    if (!row) throw notFound('Competition not found');

    const status = oneOf(req.body?.status, 'status', COMPETITION_STATUSES);
    if (status !== row.status) {
      db.prepare('UPDATE competitions SET status = ?, rev = rev + 1, updated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        row.id,
      );
      dropCache(row.id);
      audit(req, {
        action: 'competition.status',
        targetType: 'competition',
        targetId: row.id,
        targetLabel: row.name,
        detail: `${row.status} -> ${status}`,
      });
    }
    noStore(res).json({ competition: adminCompetition({ ...row, status }) });
  }),
);

sysadminRouter.delete(
  '/competitions/:id',
  wrap((req, res) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM competitions WHERE id = ?').get(req.params.id);
    if (!row) throw notFound('Competition not found');

    db.prepare('DELETE FROM competitions WHERE id = ?').run(row.id);
    dropCache(row.id);
    hub.closeTopic(row.id);

    audit(req, {
      action: 'competition.delete',
      targetType: 'competition',
      targetId: row.id,
      targetLabel: row.name,
    });
    res.json({ ok: true });
  }),
);

// --- operations --------------------------------------------------------

sysadminRouter.get(
  '/audit',
  wrap((req, res) => {
    const { limit, offset } = paging(req, { defaultLimit: 50, maxLimit: 500 });
    noStore(res).json({ ...recentAudit(getDb(), { limit, offset }), limit, offset });
  }),
);

sysadminRouter.post(
  '/backup',
  wrap((req, res) => {
    if (config.dbPath === ':memory:') throw badRequest('no_file_database', 'This instance runs an in-memory database');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(config.backupDir, `judgium-${stamp}.db`);
    checkpoint();
    const result = backupTo(target);

    audit(req, { action: 'backup.create', targetType: 'database', targetLabel: path.basename(result.path) });
    res.status(201).json({ backup: { path: result.path, bytes: result.bytes, createdAt: new Date().toISOString() } });
  }),
);

sysadminRouter.post(
  '/bootstrap-superadmins',
  wrap((req, res) => {
    const promoted = bootstrapSuperadmins(getDb());
    if (promoted.length > 0) {
      audit(req, { action: 'user.bootstrap', targetType: 'user', detail: promoted.join(', ') });
    }
    res.json({ promoted });
  }),
);
