import express from 'express';
import { getDb } from '../db/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { hub } from '../lib/events.js';
import { boardLink, enterLink, judgeLink, noStore, wrap } from '../lib/http.js';
import { newId, slugify } from '../lib/ids.js';
import { templateCriteria } from '../lib/templates.js';
import { bool, oneOf, str } from '../lib/validate.js';
import { config } from '../config.js';
import { boardPayload, dropCache, getResults, touchCompetition } from '../services/results.js';
import { loadOwnedCompetition } from '../middleware/competition.js';
import { requireUser, requireOrganizer } from '../middleware/session.js';

export const competitionsRouter = express.Router();
competitionsRouter.use(requireUser);
competitionsRouter.use(requireOrganizer);

const STATUSES = ['draft', 'live', 'closed'];
const SCORING_MODES = ['points', 'weighted'];
const AGGREGATES = ['avg', 'sum'];

const summarize = (row, counts) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  slug: row.public_slug,
  status: row.status,
  scoringMode: row.scoring_mode,
  aggregate: row.aggregate,
  dropHighLow: !!row.drop_high_low,
  publicBoard: !!row.public_board,
  showScoresOnBoard: !!row.show_scores_on_board,
  allowNotes: !!row.allow_notes,
  allowDecimals: !!row.allow_decimals,
  submissionsOpen: !!row.submissions_open,
  rev: row.rev,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  counts: counts || undefined,
});

competitionsRouter.get(
  '/',
  wrap((req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM entries  e WHERE e.competition_id  = c.id) AS entry_count,
                (SELECT COUNT(*) FROM judges   j WHERE j.competition_id  = c.id) AS judge_count,
                (SELECT COUNT(*) FROM criteria k WHERE k.competition_id  = c.id) AS criterion_count,
                (SELECT COUNT(*) FROM judges j WHERE j.competition_id = c.id AND j.completed_at IS NOT NULL) AS judges_done
           FROM competitions c
          WHERE c.owner_id = ?
          ORDER BY c.updated_at DESC`,
      )
      .all(req.user.id);

    noStore(res).json({
      competitions: rows.map((r) =>
        summarize(r, {
          entries: r.entry_count,
          judges: r.judge_count,
          criteria: r.criterion_count,
          judgesCompleted: r.judges_done,
        }),
      ),
    });
  }),
);

competitionsRouter.post(
  '/',
  wrap((req, res) => {
    const db = getDb();
    const name = str(req.body?.name, 'name', { required: true });
    const description = str(req.body?.description, 'description', { max: config.limits.descriptionMaxLength });
    const templateId = str(req.body?.template, 'template', { max: 40 }) || 'general';
    const criteria = templateCriteria(templateId);
    if (!criteria) throw badRequest('unknown_template', `Unknown rubric template: ${templateId}`);
    const scoringMode = oneOf(req.body?.scoringMode, 'scoringMode', SCORING_MODES, 'points');

    const now = new Date().toISOString();
    const id = newId('c_');

    const create = db.transaction(() => {
      // slugify() appends random characters, so a collision means we simply retry.
      let slug = slugify(name);
      for (let attempt = 0; attempt < 5; attempt++) {
        const clash = db.prepare('SELECT 1 FROM competitions WHERE public_slug = ?').get(slug);
        if (!clash) break;
        slug = slugify(name);
        if (attempt === 4) throw conflict('slug_conflict', 'Could not allocate a public URL, please retry');
      }

      db.prepare(
        `INSERT INTO competitions (id, owner_id, name, description, public_slug, status, scoring_mode,
                                   aggregate, drop_high_low, public_board, show_scores_on_board,
                                   allow_notes, allow_decimals, rev, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, 'avg', 0, 1, 1, 1, 1, 0, ?, ?)`,
      ).run(id, req.user.id, name, description, slug, scoringMode, now, now);

      const insertCriterion = db.prepare(
        `INSERT INTO criteria (id, competition_id, track_id, name, description, max_score, weight, sort_order, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of criteria) {
        insertCriterion.run(newId('k_'), id, c.name, c.description, c.maxScore, c.weight, c.sortOrder, now);
      }
    });
    create();

    const row = db.prepare('SELECT * FROM competitions WHERE id = ?').get(id);
    res.status(201).json({ competition: summarize(row) });
  }),
);

competitionsRouter.get(
  '/:competitionId',
  loadOwnedCompetition,
  wrap((req, res) => {
    const db = getDb();
    const c = req.competition;
    const results = getResults(c.id, { db });

    const noteRows = db
      .prepare(
        `SELECT n.judge_id, n.entry_id, n.body, n.updated_at
           FROM notes n JOIN entries e ON e.id = n.entry_id
          WHERE e.competition_id = ? AND TRIM(n.body) <> ''`,
      )
      .all(c.id);

    const judges = db
      .prepare('SELECT * FROM judges WHERE competition_id = ? ORDER BY sort_order, created_at')
      .all(c.id);
    const judgeTrackRows = db
      .prepare(
        `SELECT jt.judge_id, jt.track_id FROM judge_tracks jt
           JOIN judges j ON j.id = jt.judge_id WHERE j.competition_id = ?`,
      )
      .all(c.id);
    const trackIdsByJudge = new Map();
    for (const r of judgeTrackRows) {
      if (!trackIdsByJudge.has(r.judge_id)) trackIdsByJudge.set(r.judge_id, []);
      trackIdsByJudge.get(r.judge_id).push(r.track_id);
    }

    noStore(res).json({
      competition: summarize(c, {
        entries: results.stats.entryCount,
        judges: results.stats.judgeCount,
        criteria: results.stats.criterionCount,
        judgesCompleted: results.stats.judgesCompleted,
      }),
      boardUrl: boardLink(req, c.public_slug),
      // The link an organizer hands to entrants. Shown whether or not the
      // window is open, so it can be distributed before it opens.
      enterUrl: enterLink(req, c.public_slug),
      tracks: results.tracks.map((t) => ({ id: t.id, name: t.name, sortOrder: t.sort_order })),
      criteria: results.criteria.map((k) => ({
        id: k.id,
        trackId: k.track_id,
        name: k.name,
        description: k.description,
        maxScore: k.max_score,
        weight: k.weight,
        sortOrder: k.sort_order,
      })),
      entries: db
        .prepare(
          `SELECT e.*, u.name AS submitter_name
             FROM entries e LEFT JOIN users u ON u.id = e.submitted_by
            WHERE e.competition_id = ?
            ORDER BY e.sort_order, e.created_at`,
        )
        .all(c.id)
        .map((e) => ({
          id: e.id,
          trackId: e.track_id,
          name: e.name,
          teamName: e.team_name,
          description: e.description,
          projectUrl: e.project_url,
          videoUrl: e.video_url,
          tableLabel: e.table_label,
          // The participant who submitted it, by name only, or null when an
          // organizer added the entry themselves.
          submittedBy: e.submitted_by ? (e.submitter_name ?? null) : null,
          sortOrder: e.sort_order,
        })),
      judges: judges.map((j) => ({
        id: j.id,
        name: j.name,
        email: j.email,
        token: j.token,
        link: judgeLink(req, j.token),
        locale: j.locale,
        trackIds: trackIdsByJudge.get(j.id) || [],
        completedAt: j.completed_at,
        lastSeenAt: j.last_seen_at,
        sortOrder: j.sort_order,
      })),
      results: { rows: results.rows, stats: results.stats, rev: results.rev, computedAt: results.computedAt },
      notes: noteRows.map((n) => ({
        judgeId: n.judge_id,
        entryId: n.entry_id,
        body: n.body,
        updatedAt: n.updated_at,
      })),
    });
  }),
);

competitionsRouter.patch(
  '/:competitionId',
  loadOwnedCompetition,
  wrap((req, res) => {
    const db = getDb();
    const c = req.competition;
    const body = req.body || {};

    const patch = {
      name: body.name === undefined ? c.name : str(body.name, 'name', { required: true }),
      description:
        body.description === undefined
          ? c.description
          : str(body.description, 'description', { max: config.limits.descriptionMaxLength }),
      status: body.status === undefined ? c.status : oneOf(body.status, 'status', STATUSES),
      scoring_mode:
        body.scoringMode === undefined ? c.scoring_mode : oneOf(body.scoringMode, 'scoringMode', SCORING_MODES),
      aggregate: body.aggregate === undefined ? c.aggregate : oneOf(body.aggregate, 'aggregate', AGGREGATES),
      drop_high_low: body.dropHighLow === undefined ? c.drop_high_low : bool(body.dropHighLow) ? 1 : 0,
      public_board: body.publicBoard === undefined ? c.public_board : bool(body.publicBoard) ? 1 : 0,
      show_scores_on_board:
        body.showScoresOnBoard === undefined ? c.show_scores_on_board : bool(body.showScoresOnBoard) ? 1 : 0,
      allow_notes: body.allowNotes === undefined ? c.allow_notes : bool(body.allowNotes) ? 1 : 0,
      allow_decimals: body.allowDecimals === undefined ? c.allow_decimals : bool(body.allowDecimals) ? 1 : 0,
      // The submission window. Turning it off is the deadline: a participant
      // can no longer add, edit or withdraw at /enter/<slug>.
      submissions_open: body.submissionsOpen === undefined ? c.submissions_open : bool(body.submissionsOpen) ? 1 : 0,
    };

    db.prepare(
      `UPDATE competitions
          SET name = @name, description = @description, status = @status, scoring_mode = @scoring_mode,
              aggregate = @aggregate, drop_high_low = @drop_high_low, public_board = @public_board,
              show_scores_on_board = @show_scores_on_board, allow_notes = @allow_notes,
              allow_decimals = @allow_decimals, submissions_open = @submissions_open
        WHERE id = @id`,
    ).run({ ...patch, id: c.id });

    touchCompetition(c.id, { db });
    const row = db.prepare('SELECT * FROM competitions WHERE id = ?').get(c.id);
    res.json({ competition: summarize(row) });
  }),
);

competitionsRouter.post(
  '/:competitionId/regenerate-slug',
  loadOwnedCompetition,
  wrap((req, res) => {
    const db = getDb();
    const slug = slugify(req.competition.name);
    db.prepare('UPDATE competitions SET public_slug = ?, updated_at = ? WHERE id = ?').run(
      slug,
      new Date().toISOString(),
      req.competition.id,
    );
    touchCompetition(req.competition.id, { db });
    res.json({ slug, boardUrl: boardLink(req, slug) });
  }),
);

competitionsRouter.delete(
  '/:competitionId',
  loadOwnedCompetition,
  wrap((req, res) => {
    // ON DELETE CASCADE clears tracks, criteria, entries, judges, scores, notes.
    getDb().prepare('DELETE FROM competitions WHERE id = ?').run(req.competition.id);
    dropCache(req.competition.id);
    res.json({ ok: true });
  }),
);

competitionsRouter.get(
  '/:competitionId/results',
  loadOwnedCompetition,
  wrap((req, res) => {
    const results = getResults(req.competition.id);
    noStore(res).json({
      rows: results.rows,
      stats: results.stats,
      judges: results.judges,
      criteria: results.criteria.map((k) => ({ id: k.id, name: k.name, maxScore: k.max_score, weight: k.weight })),
      rev: results.rev,
      computedAt: results.computedAt,
    });
  }),
);

/** Live board stream for the organizer view (same payload as the public one). */
competitionsRouter.get(
  '/:competitionId/live',
  loadOwnedCompetition,
  wrap((req, res) => {
    const client = hub.subscribe(req.competition.id, req, res);
    if (!client) {
      res.setHeader('Retry-After', '15');
      return res.status(503).json({
        error: { code: 'live_capacity', message: 'Live update capacity reached, falling back to polling' },
      });
    }
    hub.sendTo(client, 'board', boardPayload(req.competition.id));
  }),
);

/** Wipes every score and note but keeps the roster - useful after a dry run. */
competitionsRouter.post(
  '/:competitionId/reset-scores',
  loadOwnedCompetition,
  wrap((req, res) => {
    const db = getDb();
    const id = req.competition.id;
    const reset = db.transaction(() => {
      db.prepare('DELETE FROM scores WHERE entry_id IN (SELECT id FROM entries WHERE competition_id = ?)').run(id);
      db.prepare('DELETE FROM notes  WHERE entry_id IN (SELECT id FROM entries WHERE competition_id = ?)').run(id);
      db.prepare('UPDATE judges SET completed_at = NULL WHERE competition_id = ?').run(id);
    });
    reset();
    touchCompetition(id, { db });
    res.json({ ok: true });
  }),
);
