import { getDb } from '../db/index.js';
import { newId } from './ids.js';

/**
 * Records one platform-administrator action.
 *
 * Superadmin writes cross tenant boundaries - suspending an organizer, wiping
 * someone else's competition, resetting a password - so every one of them is
 * written down with who did it and against what. Never throws: losing an audit
 * row must not turn a successful action into a 500.
 */
export function audit(req, { action, targetType = '', targetId = '', targetLabel = '', detail = '' }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log
           (id, actor_id, actor_email, action, target_type, target_id, target_label, detail, ip, created_at)
         VALUES (@id, @actor_id, @actor_email, @action, @target_type, @target_id, @target_label, @detail, @ip, @created_at)`,
      )
      .run({
        id: newId('al_'),
        actor_id: req.user?.id ?? null,
        actor_email: req.user?.email ?? '',
        action,
        target_type: targetType,
        target_id: targetId,
        target_label: targetLabel,
        detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
        ip: req.ip ?? '',
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    console.error('[audit] could not record', action, err);
  }
}

export function recentAudit(db, { limit = 50, offset = 0 } = {}) {
  const rows = db
    .prepare(
      `SELECT id, actor_id, actor_email, action, target_type, target_id, target_label, detail, ip, created_at
         FROM audit_log
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  return {
    total,
    events: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label,
      detail: row.detail,
      ip: row.ip,
      createdAt: row.created_at,
    })),
  };
}
