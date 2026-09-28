import express from 'express';
import { config, LOCALES } from '../config.js';
import { getDb } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { noStore, wrap } from '../lib/http.js';
import { criteriaForTrack, judgeTotalFor, maxTotalFor } from '../lib/scoring.js';
import { num, oneOf, round2, str } from '../lib/validate.js';
import { touchCompetition } from '../services/results.js';

export const judgeRouter = express.Router();

const nowIso = () => new Date().toISOString();
const LAST_SEEN_THROTTLE_MS = 60_000;

/** Resolves the bearer token in the URL to a judge + their competition. */
function loadJudge(req, _res, next) {
  const token = String(req.params.token || '');
  if (token.length < 8 || token.length > 64) return next(notFound('This judging link is not valid'));
  const db = getDb();
  const judge = db.prepare('SELECT * FROM judges WHERE token = ?').get(token);
  if (!judge) return next(notFound('This judging link is not valid'));
  const competition = db.prepare('SELECT * FROM competitions WHERE id = ?').get(judge.competition_id);
  if (!competition) return next(notFound('This judging link is not valid'));
  req.judge = judge;
  req.competition = competition;
  next();
}

judgeRouter.param('token', (req, res, next) => loadJudge(req, res, next));

/** Writes are allowed while the event is draft or live, and never once closed. */
function assertWritable(req) {
  if (req.competition.status === 'closed') {
    throw forbidden('Judging is closed for this competition');
  }
  if (req.judge.completed_at) {
    throw forbidden('You have already submitted. Reopen your scorecard to make changes.');
  }
}

function trackName(db, trackId) {
  if (!trackId) return '';
  return db.prepare('SELECT name FROM tracks WHERE id = ?').get(trackId)?.name || '';
}

/** Everything the judge's scoring view needs, in one round trip. */
function buildJudgeView(req) {
  const db = getDb();
  const { judge, competition } = req;

  const criteria = db
    .prepare('SELECT * FROM criteria WHERE competition_id = ? ORDER BY sort_order, created_at')
    .all(competition.id);
  const tracks = db
    .prepare('SELECT * FROM tracks WHERE competition_id = ? ORDER BY sort_order, created_at')
    .all(competition.id);
  const assignedTracks = new Set(
    db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(judge.id).map((r) => r.track_id),
  );

  const allEntries = db
    .prepare('SELECT * FROM entries WHERE competition_id = ? ORDER BY sort_order, created_at')
    .all(competition.id);
  const entries = allEntries.filter(
    (e) => assignedTracks.size === 0 || !e.track_id || assignedTracks.has(e.track_id),
  );

  const scoreRows = db.prepare('SELECT entry_id, criterion_id, value FROM scores WHERE judge_id = ?').all(judge.id);
  const scoresByEntry = new Map();
  for (const row of scoreRows) {
    if (!scoresByEntry.has(row.entry_id)) scoresByEntry.set(row.entry_id, new Map());
    scoresByEntry.get(row.entry_id).set(row.criterion_id, row.value);
  }
  const noteRows = db.prepare('SELECT entry_id, body FROM notes WHERE judge_id = ?').all(judge.id);
  const notesByEntry = new Map(noteRows.map((n) => [n.entry_id, n.body]));

  const trackNames = new Map(tracks.map((t) => [t.id, t.name]));
  const applicableCache = new Map();
  const applicableFor = (trackId) => {
    const key = trackId || '';
    if (!applicableCache.has(key)) applicableCache.set(key, criteriaForTrack(criteria, trackId));
    return applicableCache.get(key);
  };

  let scoredCount = 0;
  let completeCount = 0;

  const entryViews = entries.map((entry) => {
    const applicable = applicableFor(entry.track_id);
    const values = scoresByEntry.get(entry.id) || new Map();
    const { total, filled } = judgeTotalFor(competition, applicable, values);
    const complete = applicable.length > 0 && filled === applicable.length;
    if (filled > 0) scoredCount++;
    if (complete) completeCount++;

    return {
      id: entry.id,
      name: entry.name,
      teamName: entry.team_name,
      description: entry.description,
      projectUrl: entry.project_url,
      videoUrl: entry.video_url,
      tableLabel: entry.table_label,
      trackId: entry.track_id,
      trackName: entry.track_id ? trackNames.get(entry.track_id) || '' : '',
      criterionIds: applicable.map((c) => c.id),
      scores: Object.fromEntries(applicable.map((c) => [c.id, values.has(c.id) ? values.get(c.id) : null])),
      notes: notesByEntry.get(entry.id) || '',
      total: round2(total),
      maxTotal: round2(maxTotalFor(competition, applicable)),
      filled,
      criterionCount: applicable.length,
      complete,
    };
  });

  return {
    judge: {
      id: judge.id,
      name: judge.name,
      locale: judge.locale,
      completedAt: judge.completed_at,
    },
    competition: {
      id: competition.id,
      name: competition.name,
      description: competition.description,
      status: competition.status,
      scoringMode: competition.scoring_mode,
      allowNotes: !!competition.allow_notes,
      allowDecimals: !!competition.allow_decimals,
      notesMaxLength: config.limits.notesMaxLength,
    },
    criteria: criteria.map((c) => ({
      id: c.id,
      trackId: c.track_id,
      name: c.name,
      description: c.description,
      maxScore: c.max_score,
      weight: c.weight,
    })),
    entries: entryViews,
    progress: {
      scored: scoredCount,
      complete: completeCount,
      total: entryViews.length,
    },
    writable: competition.status !== 'closed' && !judge.completed_at,
  };
}

/**
 * Progress counters without rebuilding the whole scorecard view. Autosave hits
 * this on every debounced keystroke, so it stays aggregate-query shaped rather
 * than loading every score the judge has entered.
 */
function computeProgress(req) {
  const db = getDb();
  const { judge, competition } = req;

  const assigned = new Set(
    db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(judge.id).map((r) => r.track_id),
  );
  const globalCriteria = db
    .prepare('SELECT COUNT(*) AS n FROM criteria WHERE competition_id = ? AND track_id IS NULL')
    .get(competition.id).n;
  const perTrackCriteria = new Map(
    db
      .prepare(
        `SELECT track_id, COUNT(*) AS n FROM criteria
          WHERE competition_id = ? AND track_id IS NOT NULL GROUP BY track_id`,
      )
      .all(competition.id)
      .map((r) => [r.track_id, r.n]),
  );
  const filledByEntry = new Map(
    db
      .prepare('SELECT entry_id, COUNT(*) AS n FROM scores WHERE judge_id = ? GROUP BY entry_id')
      .all(judge.id)
      .map((r) => [r.entry_id, r.n]),
  );

  let scored = 0;
  let complete = 0;
  let total = 0;
  const entries = db.prepare('SELECT id, track_id FROM entries WHERE competition_id = ?').all(competition.id);
  for (const entry of entries) {
    if (assigned.size > 0 && entry.track_id && !assigned.has(entry.track_id)) continue;
    total++;
    const need = globalCriteria + (entry.track_id ? perTrackCriteria.get(entry.track_id) || 0 : 0);
    const have = filledByEntry.get(entry.id) || 0;
    if (have > 0) scored++;
    if (need > 0 && have >= need) complete++;
  }
  return { scored, complete, total };
}

judgeRouter.get(
  '/:token',
  wrap((req, res) => {
    const db = getDb();
    const last = req.judge.last_seen_at ? Date.parse(req.judge.last_seen_at) : 0;
    if (!Number.isFinite(last) || Date.now() - last > LAST_SEEN_THROTTLE_MS) {
      // Throttled so a reconnecting phone does not write on every poll.
      db.prepare('UPDATE judges SET last_seen_at = ? WHERE id = ?').run(nowIso(), req.judge.id);
    }
    noStore(res).json(buildJudgeView(req));
  }),
);

/**
 * Autosave endpoint. Accepts a partial patch of one entry's scorecard:
 *   { scores: { <criterionId>: number | null }, notes?: string }
 * A null score clears that criterion. Applied in one transaction so a flaky
 * connection cannot leave half a scorecard written.
 */
judgeRouter.patch(
  '/:token/entries/:entryId',
  wrap((req, res) => {
    assertWritable(req);
    const db = getDb();
    const { judge, competition } = req;

    const entry = db
      .prepare('SELECT * FROM entries WHERE id = ? AND competition_id = ?')
      .get(String(req.params.entryId), competition.id);
    if (!entry) throw notFound('Entry not found');

    const assignedTracks = new Set(
      db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(judge.id).map((r) => r.track_id),
    );
    if (assignedTracks.size > 0 && entry.track_id && !assignedTracks.has(entry.track_id)) {
      throw forbidden('This entry is not in your assigned track');
    }

    const allCriteria = db.prepare('SELECT * FROM criteria WHERE competition_id = ?').all(competition.id);
    const applicable = criteriaForTrack(allCriteria, entry.track_id);
    const byId = new Map(applicable.map((c) => [c.id, c]));

    const scoresPatch = req.body?.scores;
    if (scoresPatch !== undefined && (typeof scoresPatch !== 'object' || scoresPatch === null || Array.isArray(scoresPatch))) {
      throw badRequest('invalid_type', 'scores must be an object keyed by criterion id');
    }

    const hasNotes = req.body?.notes !== undefined;
    if (hasNotes && !competition.allow_notes) throw forbidden('Feedback notes are disabled for this competition');
    const notesBody = hasNotes
      ? str(req.body.notes, 'notes', { max: config.limits.notesMaxLength, trim: false })
      : null;

    const upsertScore = db.prepare(
      `INSERT INTO scores (judge_id, entry_id, criterion_id, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(judge_id, entry_id, criterion_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const deleteScore = db.prepare('DELETE FROM scores WHERE judge_id = ? AND entry_id = ? AND criterion_id = ?');

    const apply = db.transaction(() => {
      if (scoresPatch) {
        for (const [criterionId, raw] of Object.entries(scoresPatch)) {
          const criterion = byId.get(criterionId);
          if (!criterion) throw badRequest('unknown_criterion', 'Unknown criterion for this entry', { criterionId });
          if (raw === null || raw === '') {
            deleteScore.run(judge.id, entry.id, criterionId);
            continue;
          }
          let value = num(raw, criterion.name, { required: true, min: 0, max: criterion.max_score });
          if (!competition.allow_decimals) {
            value = num(Math.round(value), criterion.name, { min: 0, max: criterion.max_score, integer: true });
          } else {
            value = round2(value);
          }
          upsertScore.run(judge.id, entry.id, criterionId, value, nowIso());
        }
      }
      if (notesBody !== null) {
        if (notesBody.trim() === '') {
          db.prepare('DELETE FROM notes WHERE judge_id = ? AND entry_id = ?').run(judge.id, entry.id);
        } else {
          db.prepare(
            `INSERT INTO notes (judge_id, entry_id, body, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(judge_id, entry_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
          ).run(judge.id, entry.id, notesBody, nowIso());
        }
      }
    });
    apply();

    touchCompetition(competition.id, { db });

    const values = new Map(
      db
        .prepare('SELECT criterion_id, value FROM scores WHERE judge_id = ? AND entry_id = ?')
        .all(judge.id, entry.id)
        .map((r) => [r.criterion_id, r.value]),
    );
    const { total, filled } = judgeTotalFor(competition, applicable, values);

    res.json({
      entry: {
        id: entry.id,
        scores: Object.fromEntries(applicable.map((c) => [c.id, values.has(c.id) ? values.get(c.id) : null])),
        notes: db.prepare('SELECT body FROM notes WHERE judge_id = ? AND entry_id = ?').get(judge.id, entry.id)?.body || '',
        total: round2(total),
        maxTotal: round2(maxTotalFor(competition, applicable)),
        filled,
        criterionCount: applicable.length,
        complete: applicable.length > 0 && filled === applicable.length,
      },
      progress: computeProgress(req),
      savedAt: nowIso(),
    });
  }),
);

judgeRouter.post(
  '/:token/complete',
  wrap((req, res) => {
    if (req.competition.status === 'closed') throw forbidden('Judging is closed for this competition');
    const db = getDb();
    const view = buildJudgeView(req);
    const unfinished = view.entries.filter((e) => !e.complete);
    if (unfinished.length > 0 && !req.body?.force) {
      throw badRequest('incomplete_scorecard', 'Some entries are not fully scored yet', {
        unfinished: unfinished.map((e) => ({ id: e.id, name: e.name, filled: e.filled, of: e.criterionCount })),
      });
    }
    db.prepare('UPDATE judges SET completed_at = ? WHERE id = ?').run(nowIso(), req.judge.id);
    touchCompetition(req.competition.id, { db });
    res.json({ completedAt: nowIso(), progress: view.progress });
  }),
);

judgeRouter.post(
  '/:token/reopen',
  wrap((req, res) => {
    if (req.competition.status === 'closed') throw forbidden('Judging is closed for this competition');
    const db = getDb();
    db.prepare('UPDATE judges SET completed_at = NULL WHERE id = ?').run(req.judge.id);
    touchCompetition(req.competition.id, { db });
    res.json({ ok: true });
  }),
);

/** Remembers the judge's language choice so their link opens translated. */
judgeRouter.post(
  '/:token/locale',
  wrap((req, res) => {
    const locale = oneOf(req.body?.locale, 'locale', LOCALES);
    getDb().prepare('UPDATE judges SET locale = ? WHERE id = ?').run(locale, req.judge.id);
    res.json({ locale });
  }),
);
