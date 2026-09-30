import express from 'express';
import { getDb } from '../db/index.js';
import {
  contentDisposition,
  csvFilename,
  entriesCsv,
  leaderboardCsv,
  notesCsv,
  perJudgeCsv,
} from '../lib/csv.js';
import { noStore, wrap } from '../lib/http.js';
import { getResults } from '../services/results.js';
import { loadOwnedCompetition } from '../middleware/competition.js';
import { requireUser, requireOrganizer } from '../middleware/session.js';

export const exportsRouter = express.Router();
exportsRouter.use(requireUser);
exportsRouter.use(requireOrganizer);
exportsRouter.param('competitionId', (req, res, next) => loadOwnedCompetition(req, res, next));

function sendCsv(res, competitionName, suffix, body) {
  const filename = csvFilename(competitionName, suffix);
  noStore(res);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.send(body);
}

/**
 * Entry fields the leaderboard result does not carry: the description, the
 * submitter's name, and the organizer's own ordering.
 *
 * Loaded here rather than added to getResults on purpose. That result is
 * memoised against the competition's rev and recomputed on every score
 * change to drive the live board, so it should not grow a join on users for
 * the sake of an export somebody takes once at the end.
 */
function loadEntryExtras(db, competitionId) {
  return new Map(
    db
      .prepare(
        `SELECT e.id, e.description, e.sort_order, u.name AS submitter
           FROM entries e LEFT JOIN users u ON u.id = e.submitted_by
          WHERE e.competition_id = ?`,
      )
      .all(competitionId)
      .map((r) => [r.id, { description: r.description, submitter: r.submitter, sortOrder: r.sort_order }]),
  );
}

function loadNotes(db, competitionId) {
  return db
    .prepare(
      `SELECT n.judge_id, n.entry_id, n.body, n.updated_at
         FROM notes n JOIN entries e ON e.id = n.entry_id
        WHERE e.competition_id = ?`,
    )
    .all(competitionId);
}

exportsRouter.get(
  '/:competitionId/export/leaderboard.csv',
  wrap((req, res) => {
    const results = getResults(req.competition.id);
    sendCsv(res, req.competition.name, 'leaderboard', leaderboardCsv(results));
  }),
);

/** The roster as entered, with the description and links a judge reads. */
exportsRouter.get(
  '/:competitionId/export/entries.csv',
  wrap((req, res) => {
    const db = getDb();
    const results = getResults(req.competition.id, { db });
    sendCsv(
      res,
      req.competition.name,
      'entries',
      entriesCsv(results, loadEntryExtras(db, req.competition.id)),
    );
  }),
);

exportsRouter.get(
  '/:competitionId/export/per-judge.csv',
  wrap((req, res) => {
    const db = getDb();
    const results = getResults(req.competition.id, { db });
    const notes = new Map(loadNotes(db, req.competition.id).map((n) => [`${n.judge_id}:${n.entry_id}`, n.body]));
    sendCsv(res, req.competition.name, 'per-judge', perJudgeCsv(results, notes));
  }),
);

exportsRouter.get(
  '/:competitionId/export/notes.csv',
  wrap((req, res) => {
    const db = getDb();
    const results = getResults(req.competition.id, { db });
    sendCsv(res, req.competition.name, 'feedback', notesCsv(results, loadNotes(db, req.competition.id)));
  }),
);

/** Full machine-readable snapshot: rubric, roster, every score, every note. */
exportsRouter.get(
  '/:competitionId/export/full.json',
  wrap((req, res) => {
    const db = getDb();
    const c = req.competition;
    const results = getResults(c.id, { db });
    const entryExtras = loadEntryExtras(db, c.id);
    const payload = {
      exportedAt: new Date().toISOString(),
      competition: {
        id: c.id,
        name: c.name,
        description: c.description,
        slug: c.public_slug,
        status: c.status,
        scoringMode: c.scoring_mode,
        aggregate: c.aggregate,
        dropHighLow: !!c.drop_high_low,
        createdAt: c.created_at,
      },
      tracks: results.tracks.map((t) => ({ id: t.id, name: t.name })),
      criteria: results.criteria.map((k) => ({
        id: k.id,
        trackId: k.track_id,
        name: k.name,
        description: k.description,
        maxScore: k.max_score,
        weight: k.weight,
      })),
      judges: results.judges,
      // The leaderboard rows plus the two entry fields they do not carry, so a
      // snapshot is enough to reconstruct what was submitted as well as how it
      // scored.
      leaderboard: results.rows.map((r) => {
        const extra = entryExtras.get(r.id) || {};
        return { ...r, description: extra.description ?? '', submittedBy: extra.submitter ?? null };
      }),
      notes: loadNotes(db, c.id).map((n) => ({
        judgeId: n.judge_id,
        entryId: n.entry_id,
        body: n.body,
        updatedAt: n.updated_at,
      })),
      stats: results.stats,
    };
    noStore(res);
    res.setHeader(
      'Content-Disposition',
      contentDisposition(csvFilename(c.name, 'full').replace(/\.csv$/, '.json')),
    );
    res.json(payload);
  }),
);
