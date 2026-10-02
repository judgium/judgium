/** Snapshots taken before an operation destroys scoring work.
 *
 *  Scores and feedback are the one thing in this database that cannot be
 *  re-entered: they are human judgement, often collected once during a
 *  four-minute demo. Entries and rubrics can be retyped; a panel's scores
 *  cannot. Every delete here is a plain DELETE with no soft-delete column and
 *  no retention, so a mis-clicked "clear all scores" mid-event used to be
 *  final.
 *
 *  So: before an operation that would remove score or note rows, write a
 *  snapshot. Operations that would remove none - deleting an unscored entry,
 *  renaming things - take none, which keeps the common case free.
 */
import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { backupTo } from '../db/index.js';

/** Snapshots live beside the manual ones but in their own directory, so
 *  `npm run backup` output is never pruned by the automatic retention. */
export const autoSnapshotDir = () => path.join(config.backupDir, 'pre-delete');

/**
 * How much judgement a pending operation would destroy.
 *
 * `scope` is the competition plus at most one narrowing id. The cascades are
 * not obvious, so they are spelled out rather than inferred:
 *   judge     -> its scores and notes
 *   entry     -> its scores and notes
 *   criterion -> its scores
 *   track     -> the scores of every criterion belonging to that track,
 *                because criteria.track_id cascades on delete
 */
export function judgementAtRisk(db, { competitionId, judgeId, entryId, criterionId, trackId } = {}) {
  const one = (sql, ...params) => db.prepare(sql).get(...params)?.n ?? 0;

  if (judgeId) {
    return {
      scores: one('SELECT COUNT(*) AS n FROM scores WHERE judge_id = ?', judgeId),
      notes: one('SELECT COUNT(*) AS n FROM notes WHERE judge_id = ?', judgeId),
    };
  }
  if (entryId) {
    return {
      scores: one('SELECT COUNT(*) AS n FROM scores WHERE entry_id = ?', entryId),
      notes: one('SELECT COUNT(*) AS n FROM notes WHERE entry_id = ?', entryId),
    };
  }
  if (criterionId) {
    return { scores: one('SELECT COUNT(*) AS n FROM scores WHERE criterion_id = ?', criterionId), notes: 0 };
  }
  if (trackId) {
    return {
      scores: one(
        `SELECT COUNT(*) AS n FROM scores
          WHERE criterion_id IN (SELECT id FROM criteria WHERE track_id = ?)`,
        trackId,
      ),
      notes: 0,
    };
  }
  // Whole competition.
  return {
    scores: one(
      `SELECT COUNT(*) AS n FROM scores
        WHERE entry_id IN (SELECT id FROM entries WHERE competition_id = ?)`,
      competitionId,
    ),
    notes: one(
      `SELECT COUNT(*) AS n FROM notes
        WHERE entry_id IN (SELECT id FROM entries WHERE competition_id = ?)`,
      competitionId,
    ),
  };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');

const safeSlug = (value) =>
  String(value || 'competition')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'competition';

/**
 * Keeps only the newest `keep` snapshots. Without this a live event where an
 * organizer resets scores a few times leaves a full copy of the database per
 * attempt on the same volume the database itself lives on.
 */
export function pruneAutoSnapshots(dir = autoSnapshotDir(), keep = config.autoSnapshotKeep) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.db'));
  } catch {
    return [];
  }
  if (names.length <= keep) return [];
  const sorted = names
    .map((name) => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const removed = [];
  for (const { name } of sorted.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch {
      /* a snapshot we cannot remove is not worth failing the request over */
    }
  }
  return removed;
}

/**
 * Snapshot the database before judgement is destroyed. Returns null when the
 * operation would destroy none, or when snapshots are switched off.
 *
 * Throws if a snapshot is called for and cannot be written. That is deliberate:
 * the point of this is that the delete is recoverable, and quietly proceeding
 * without the snapshot would destroy a panel's work on a full disk - the exact
 * situation it exists to prevent. AUTO_SNAPSHOT=0 is the way to accept
 * irreversible deletes.
 */
export function snapshotBeforeLoss(db, { competitionId, name, action, scope = {} } = {}) {
  const risk = judgementAtRisk(db, { competitionId, ...scope });
  if (risk.scores === 0 && risk.notes === 0) return null;
  if (!config.autoSnapshot) return null;

  const dir = autoSnapshotDir();
  const file = `${safeSlug(name)}-${action}-${stamp()}.db`;
  const result = backupTo(path.join(dir, file), db);
  pruneAutoSnapshots(dir);
  return { ...result, file, risk };
}
