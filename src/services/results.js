import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { computeResults, toPublicBoard } from '../lib/scoring.js';
import { hub, createThrottledNotifier } from '../lib/events.js';

/**
 * Memoises the computed leaderboard per competition, keyed on the
 * competition's `rev` column. Any write that can move the board bumps `rev`,
 * so a stale cache is impossible while repeated reads (the demo-room screen,
 * every judge's progress bar, the admin dashboard) stay free.
 */
const cache = new Map(); // competitionId -> { rev, results }
const MAX_CACHED_COMPETITIONS = 64;

function currentRev(db, competitionId) {
  const row = db.prepare('SELECT rev FROM competitions WHERE id = ?').get(competitionId);
  return row ? row.rev : null;
}

export function getResults(competitionId, { db = getDb() } = {}) {
  const rev = currentRev(db, competitionId);
  if (rev === null) return null;

  const hit = cache.get(competitionId);
  if (hit && hit.rev === rev) return hit.results;

  const results = computeResults(db, competitionId);
  if (!results) return null;

  if (cache.size >= MAX_CACHED_COMPETITIONS && !cache.has(competitionId)) {
    // Simple FIFO eviction; a judging session touches one competition at a time.
    cache.delete(cache.keys().next().value);
  }
  cache.set(competitionId, { rev, results });
  return results;
}

export function getPublicBoard(competitionId, options) {
  const results = getResults(competitionId, options);
  return results ? toPublicBoard(results) : null;
}

export function dropCache(competitionId) {
  cache.delete(competitionId);
}

/** Bump the revision so every cache and every live client learns about a change. */
export function touchCompetition(competitionId, { db = getDb() } = {}) {
  db.prepare('UPDATE competitions SET rev = rev + 1, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    competitionId,
  );
  cache.delete(competitionId);
  scheduleBroadcast(competitionId);
}

const paginate = (rows) => {
  const max = config.capacity.leaderboardMaxRows;
  return max > 0 ? rows.slice(0, max) : rows;
};

function broadcast(competitionId) {
  if (hub.subscriberCount(competitionId) === 0) return;
  const board = getPublicBoard(competitionId);
  if (!board) return;
  hub.publish(competitionId, 'board', { ...board, rows: paginate(board.rows) });
}

/**
 * Coalesced broadcaster: a burst of score writes from a full judging panel
 * results in one recompute-and-push per throttle window instead of one per
 * keystroke.
 */
export const scheduleBroadcast = createThrottledNotifier(broadcast);

export function boardPayload(competitionId) {
  const board = getPublicBoard(competitionId);
  if (!board) return null;
  return { ...board, rows: paginate(board.rows) };
}
