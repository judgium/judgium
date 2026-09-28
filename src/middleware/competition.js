import { getDb } from '../db/index.js';
import { forbidden, notFound } from '../lib/errors.js';

/** Loads :competitionId and asserts the signed-in organizer owns it. */
export function loadOwnedCompetition(req, _res, next) {
  const id = req.params.competitionId || req.params.id;
  const row = getDb().prepare('SELECT * FROM competitions WHERE id = ?').get(id);
  if (!row) return next(notFound('Competition not found'));
  if (!req.user || row.owner_id !== req.user.id) {
    // 404 rather than 403 so competition ids are not probeable.
    return next(notFound('Competition not found'));
  }
  req.competition = row;
  next();
}

export function assertNotClosed(req, _res, next) {
  if (req.competition?.status === 'closed') {
    return next(forbidden('This competition is closed. Reopen it before making changes.'));
  }
  next();
}

/** Next sort_order for a child table, so new rows land at the bottom. */
export function nextSortOrder(db, table, competitionId) {
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM ${table} WHERE competition_id = ?`)
    .get(competitionId);
  return (row?.max_order ?? -1) + 1;
}
