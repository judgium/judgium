import express from 'express';
import { getDb } from '../db/index.js';
import { contentDisposition, csvFilename, leaderboardCsv, notesCsv, perJudgeCsv } from '../lib/csv.js';
import { noStore, wrap } from '../lib/http.js';
import { getResults } from '../services/results.js';
import { loadOwnedCompetition } from '../middleware/competition.js';
import { requireUser } from '../middleware/session.js';

export const exportsRouter = express.Router();
exportsRouter.use(requireUser);
exportsRouter.param('competitionId', (req, res, next) => loadOwnedCompetition(req, res, next));

function sendCsv(res, competitionName, suffix, body) {
  const filename = csvFilename(competitionName, suffix);
  noStore(res);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.send(body);
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
      leaderboard: results.rows,
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
