import express from 'express';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { judgeLink, wrap } from '../lib/http.js';
import { newId, newJudgeToken } from '../lib/ids.js';
import { templateCriteria } from '../lib/templates.js';
import { email as vEmail, num, oneOf, optionalUrl, str } from '../lib/validate.js';
import { touchCompetition } from '../services/results.js';
import { loadOwnedCompetition, nextSortOrder } from '../middleware/competition.js';
import { requireUser, requireOrganizer } from '../middleware/session.js';
import { LOCALES } from '../config.js';

export const rosterRouter = express.Router();
rosterRouter.use(requireUser);
rosterRouter.use(requireOrganizer);
// Runs once per request for every route below, all of which are :competitionId
// scoped. Using param() rather than use('/:competitionId') keeps the ownership
// check attached to the parameter itself, so a new route cannot forget it.
rosterRouter.param('competitionId', (req, res, next) => loadOwnedCompetition(req, res, next));

const now = () => new Date().toISOString();

/** Resolves a client-supplied trackId, rejecting ids from other competitions. */
function resolveTrackId(db, competitionId, value, { allowNull = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowNull) return null;
    throw badRequest('missing_field', 'trackId is required');
  }
  const id = str(value, 'trackId', { max: 64 });
  const row = db.prepare('SELECT id FROM tracks WHERE id = ? AND competition_id = ?').get(id, competitionId);
  if (!row) throw badRequest('unknown_track', 'That track does not belong to this competition');
  return row.id;
}

function mustOwnChild(db, table, id, competitionId, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND competition_id = ?`).get(id, competitionId);
  if (!row) throw notFound(`${label} not found`);
  return row;
}

/**
 * Applies an explicit ordering supplied by the client. Ids not present in the
 * payload keep their position after the ones that are.
 */
function applyOrder(db, table, competitionId, ids) {
  if (!Array.isArray(ids)) throw badRequest('invalid_type', 'ids must be an array');
  const update = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ? AND competition_id = ?`);
  const run = db.transaction(() => {
    ids.forEach((id, index) => update.run(index, String(id), competitionId));
  });
  run();
}

// --- tracks ---------------------------------------------------------------

rosterRouter.post(
  '/:competitionId/tracks',
  wrap((req, res) => {
    const db = getDb();
    const id = newId('t_');
    const name = str(req.body?.name, 'name', { required: true });
    db.prepare(
      'INSERT INTO tracks (id, competition_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, req.competition.id, name, nextSortOrder(db, 'tracks', req.competition.id), now());
    touchCompetition(req.competition.id, { db });
    res.status(201).json({ track: { id, name } });
  }),
);

rosterRouter.patch(
  '/:competitionId/tracks/:trackId',
  wrap((req, res) => {
    const db = getDb();
    const track = mustOwnChild(db, 'tracks', req.params.trackId, req.competition.id, 'Track');
    const name = req.body?.name === undefined ? track.name : str(req.body.name, 'name', { required: true });
    db.prepare('UPDATE tracks SET name = ? WHERE id = ?').run(name, track.id);
    touchCompetition(req.competition.id, { db });
    res.json({ track: { id: track.id, name } });
  }),
);

rosterRouter.delete(
  '/:competitionId/tracks/:trackId',
  wrap((req, res) => {
    const db = getDb();
    const track = mustOwnChild(db, 'tracks', req.params.trackId, req.competition.id, 'Track');
    // Entries fall back to "no track"; track-scoped criteria cascade away.
    db.prepare('DELETE FROM tracks WHERE id = ?').run(track.id);
    touchCompetition(req.competition.id, { db });
    res.json({ ok: true });
  }),
);

rosterRouter.post(
  '/:competitionId/tracks/reorder',
  wrap((req, res) => {
    applyOrder(getDb(), 'tracks', req.competition.id, req.body?.ids);
    touchCompetition(req.competition.id);
    res.json({ ok: true });
  }),
);

// --- criteria -------------------------------------------------------------

const criterionPayload = (db, competitionId, body, existing) => ({
  track_id: body.trackId === undefined ? (existing?.track_id ?? null) : resolveTrackId(db, competitionId, body.trackId),
  name: body.name === undefined && existing ? existing.name : str(body.name, 'name', { required: true }),
  description:
    body.description === undefined && existing
      ? existing.description
      : str(body.description, 'description', { max: config.limits.descriptionMaxLength }),
  max_score:
    body.maxScore === undefined && existing
      ? existing.max_score
      : num(body.maxScore, 'maxScore', { required: true, min: 0.01, max: 100000 }),
  weight:
    body.weight === undefined && existing
      ? existing.weight
      : (num(body.weight, 'weight', { min: 0, max: 100000 }) ?? 1),
});

const criterionView = (k) => ({
  id: k.id,
  trackId: k.track_id,
  name: k.name,
  description: k.description,
  maxScore: k.max_score,
  weight: k.weight,
  sortOrder: k.sort_order,
});

rosterRouter.post(
  '/:competitionId/criteria',
  wrap((req, res) => {
    const db = getDb();
    const data = criterionPayload(db, req.competition.id, req.body || {}, null);
    const id = newId('k_');
    db.prepare(
      `INSERT INTO criteria (id, competition_id, track_id, name, description, max_score, weight, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.competition.id,
      data.track_id,
      data.name,
      data.description,
      data.max_score,
      data.weight,
      nextSortOrder(db, 'criteria', req.competition.id),
      now(),
    );
    touchCompetition(req.competition.id, { db });
    res.status(201).json({ criterion: criterionView(db.prepare('SELECT * FROM criteria WHERE id = ?').get(id)) });
  }),
);

rosterRouter.post(
  '/:competitionId/criteria/apply-template',
  wrap((req, res) => {
    const db = getDb();
    const templateId = str(req.body?.template, 'template', { required: true, max: 40 });
    const criteria = templateCriteria(templateId);
    if (!criteria) throw badRequest('unknown_template', `Unknown rubric template: ${templateId}`);
    const replace = str(req.body?.mode, 'mode', { max: 20 }) === 'replace';

    const apply = db.transaction(() => {
      if (replace) db.prepare('DELETE FROM criteria WHERE competition_id = ?').run(req.competition.id);
      let order = replace ? 0 : nextSortOrder(db, 'criteria', req.competition.id);
      const insert = db.prepare(
        `INSERT INTO criteria (id, competition_id, track_id, name, description, max_score, weight, sort_order, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of criteria) {
        insert.run(newId('k_'), req.competition.id, c.name, c.description, c.maxScore, c.weight, order++, now());
      }
    });
    apply();
    touchCompetition(req.competition.id, { db });
    res.json({
      criteria: db
        .prepare('SELECT * FROM criteria WHERE competition_id = ? ORDER BY sort_order')
        .all(req.competition.id)
        .map(criterionView),
    });
  }),
);

rosterRouter.patch(
  '/:competitionId/criteria/:criterionId',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'criteria', req.params.criterionId, req.competition.id, 'Criterion');
    const data = criterionPayload(db, req.competition.id, req.body || {}, existing);
    db.prepare(
      `UPDATE criteria SET track_id = @track_id, name = @name, description = @description,
              max_score = @max_score, weight = @weight WHERE id = @id`,
    ).run({ ...data, id: existing.id });

    // Lowering a maximum can leave existing scores above it; clamp them so the
    // leaderboard never shows a total above the stated maximum.
    db.prepare('UPDATE scores SET value = ?, updated_at = ? WHERE criterion_id = ? AND value > ?').run(
      data.max_score,
      now(),
      existing.id,
      data.max_score,
    );

    touchCompetition(req.competition.id, { db });
    res.json({ criterion: criterionView(db.prepare('SELECT * FROM criteria WHERE id = ?').get(existing.id)) });
  }),
);

rosterRouter.delete(
  '/:competitionId/criteria/:criterionId',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'criteria', req.params.criterionId, req.competition.id, 'Criterion');
    db.prepare('DELETE FROM criteria WHERE id = ?').run(existing.id);
    touchCompetition(req.competition.id, { db });
    res.json({ ok: true });
  }),
);

rosterRouter.post(
  '/:competitionId/criteria/reorder',
  wrap((req, res) => {
    applyOrder(getDb(), 'criteria', req.competition.id, req.body?.ids);
    touchCompetition(req.competition.id);
    res.json({ ok: true });
  }),
);

// --- entries --------------------------------------------------------------

const entryView = (e) => ({
  id: e.id,
  trackId: e.track_id,
  name: e.name,
  teamName: e.team_name,
  description: e.description,
  projectUrl: e.project_url,
  videoUrl: e.video_url,
  tableLabel: e.table_label,
  // Who submitted it: the participant's name, or null when an organizer
  // created the entry. Lets the Entries tab tell the two apart without
  // exposing the submitter's e-mail or account id.
  submittedBy: e.submitted_by ? (e.submitter_name ?? null) : null,
  sortOrder: e.sort_order,
});

const entryPayload = (db, competitionId, body, existing) => ({
  track_id: body.trackId === undefined ? (existing?.track_id ?? null) : resolveTrackId(db, competitionId, body.trackId),
  name: body.name === undefined && existing ? existing.name : str(body.name, 'name', { required: true }),
  team_name: body.teamName === undefined && existing ? existing.team_name : str(body.teamName, 'teamName'),
  description:
    body.description === undefined && existing
      ? existing.description
      : str(body.description, 'description', { max: config.limits.descriptionMaxLength }),
  project_url:
    body.projectUrl === undefined && existing ? existing.project_url : optionalUrl(body.projectUrl, 'projectUrl'),
  video_url: body.videoUrl === undefined && existing ? existing.video_url : optionalUrl(body.videoUrl, 'videoUrl'),
  table_label:
    body.tableLabel === undefined && existing ? existing.table_label : str(body.tableLabel, 'tableLabel', { max: 40 }),
});

rosterRouter.post(
  '/:competitionId/entries',
  wrap((req, res) => {
    const db = getDb();
    const data = entryPayload(db, req.competition.id, req.body || {}, null);
    const id = newId('e_');
    db.prepare(
      `INSERT INTO entries (id, competition_id, track_id, name, team_name, description, project_url,
                            video_url, table_label, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.competition.id,
      data.track_id,
      data.name,
      data.team_name,
      data.description,
      data.project_url,
      data.video_url,
      data.table_label,
      nextSortOrder(db, 'entries', req.competition.id),
      now(),
    );
    touchCompetition(req.competition.id, { db });
    res.status(201).json({ entry: entryView(db.prepare('SELECT e.*, u.name AS submitter_name FROM entries e LEFT JOIN users u ON u.id = e.submitted_by WHERE e.id = ?').get(id)) });
  }),
);

/**
 * Paste-in import. One entry per line:
 *   Project name | Team name | Track name | Table label
 * Only the first field is required, and an unknown track name is created.
 */
rosterRouter.post(
  '/:competitionId/entries/bulk',
  wrap((req, res) => {
    const db = getDb();
    const text = String(req.body?.text ?? '');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) throw badRequest('empty_import', 'Nothing to import');
    if (lines.length > config.capacity.bulkImportMaxLines) {
      throw badRequest('import_too_large', `Import at most ${config.capacity.bulkImportMaxLines} lines at a time`);
    }

    const created = [];
    const skipped = [];

    const run = db.transaction(() => {
      let order = nextSortOrder(db, 'entries', req.competition.id);
      const tracksByName = new Map(
        db
          .prepare('SELECT id, name FROM tracks WHERE competition_id = ?')
          .all(req.competition.id)
          .map((t) => [t.name.toLowerCase(), t.id]),
      );
      const insertTrack = db.prepare(
        'INSERT INTO tracks (id, competition_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      const insertEntry = db.prepare(
        `INSERT INTO entries (id, competition_id, track_id, name, team_name, description, project_url,
                              video_url, table_label, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?, ?)`,
      );

      for (const line of lines) {
        const parts = line.split(/\s*[|\t]\s*/);
        const name = (parts[0] || '').trim().slice(0, config.limits.nameMaxLength);
        if (!name) {
          skipped.push({ line, reason: 'missing_name' });
          continue;
        }
        const teamName = (parts[1] || '').trim().slice(0, config.limits.nameMaxLength);
        const trackName = (parts[2] || '').trim().slice(0, config.limits.nameMaxLength);
        const tableLabel = (parts[3] || '').trim().slice(0, 40);

        let trackId = null;
        if (trackName) {
          const key = trackName.toLowerCase();
          if (!tracksByName.has(key)) {
            const newTrackId = newId('t_');
            insertTrack.run(newTrackId, req.competition.id, trackName, tracksByName.size, now());
            tracksByName.set(key, newTrackId);
          }
          trackId = tracksByName.get(key);
        }

        const id = newId('e_');
        insertEntry.run(id, req.competition.id, trackId, name, teamName, tableLabel, order++, now());
        created.push({ id, name });
      }
    });
    run();

    touchCompetition(req.competition.id, { db });
    res.status(201).json({ created: created.length, skipped, entries: created });
  }),
);

rosterRouter.patch(
  '/:competitionId/entries/:entryId',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'entries', req.params.entryId, req.competition.id, 'Entry');
    const data = entryPayload(db, req.competition.id, req.body || {}, existing);
    db.prepare(
      `UPDATE entries SET track_id = @track_id, name = @name, team_name = @team_name, description = @description,
              project_url = @project_url, video_url = @video_url, table_label = @table_label WHERE id = @id`,
    ).run({ ...data, id: existing.id });
    touchCompetition(req.competition.id, { db });
    res.json({ entry: entryView(db.prepare('SELECT e.*, u.name AS submitter_name FROM entries e LEFT JOIN users u ON u.id = e.submitted_by WHERE e.id = ?').get(existing.id)) });
  }),
);

rosterRouter.delete(
  '/:competitionId/entries/:entryId',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'entries', req.params.entryId, req.competition.id, 'Entry');
    db.prepare('DELETE FROM entries WHERE id = ?').run(existing.id);
    touchCompetition(req.competition.id, { db });
    res.json({ ok: true });
  }),
);

rosterRouter.post(
  '/:competitionId/entries/reorder',
  wrap((req, res) => {
    applyOrder(getDb(), 'entries', req.competition.id, req.body?.ids);
    touchCompetition(req.competition.id);
    res.json({ ok: true });
  }),
);

// --- judges ---------------------------------------------------------------

function judgeView(req, j, trackIds) {
  return {
    id: j.id,
    name: j.name,
    email: j.email,
    token: j.token,
    link: judgeLink(req, j.token),
    locale: j.locale,
    trackIds: trackIds || [],
    completedAt: j.completed_at,
    lastSeenAt: j.last_seen_at,
    sortOrder: j.sort_order,
  };
}

function setJudgeTracks(db, competitionId, judgeId, trackIds) {
  db.prepare('DELETE FROM judge_tracks WHERE judge_id = ?').run(judgeId);
  if (!Array.isArray(trackIds) || trackIds.length === 0) return [];
  const insert = db.prepare('INSERT OR IGNORE INTO judge_tracks (judge_id, track_id) VALUES (?, ?)');
  const applied = [];
  for (const raw of trackIds) {
    const trackId = resolveTrackId(db, competitionId, raw, { allowNull: false });
    insert.run(judgeId, trackId);
    applied.push(trackId);
  }
  return applied;
}

rosterRouter.post(
  '/:competitionId/judges',
  wrap((req, res) => {
    const db = getDb();
    const name = str(req.body?.name, 'name', { required: true, max: 120 });
    const addr = req.body?.email ? vEmail(req.body.email, 'email', { required: false }) : '';
    const locale = req.body?.locale ? oneOf(req.body.locale, 'locale', LOCALES) : null;
    const id = newId('j_');
    const token = newJudgeToken();

    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO judges (id, competition_id, name, email, token, locale, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, req.competition.id, name, addr, token, locale, nextSortOrder(db, 'judges', req.competition.id), now());
      return setJudgeTracks(db, req.competition.id, id, req.body?.trackIds);
    });
    const trackIds = create();

    touchCompetition(req.competition.id, { db });
    res.status(201).json({ judge: judgeView(req, db.prepare('SELECT * FROM judges WHERE id = ?').get(id), trackIds) });
  }),
);

/** Paste-in import. One judge per line: `Name | email` (e-mail optional). */
rosterRouter.post(
  '/:competitionId/judges/bulk',
  wrap((req, res) => {
    const db = getDb();
    const lines = String(req.body?.text ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) throw badRequest('empty_import', 'Nothing to import');
    if (lines.length > config.capacity.bulkImportMaxLines) {
      throw badRequest('import_too_large', `Import at most ${config.capacity.bulkImportMaxLines} lines at a time`);
    }

    const skipped = [];
    const ids = [];
    const run = db.transaction(() => {
      let order = nextSortOrder(db, 'judges', req.competition.id);
      const insert = db.prepare(
        `INSERT INTO judges (id, competition_id, name, email, token, locale, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      );
      for (const line of lines) {
        const parts = line.split(/\s*[|,\t]\s*/);
        const name = (parts[0] || '').trim().slice(0, 120);
        if (!name) {
          skipped.push({ line, reason: 'missing_name' });
          continue;
        }
        let addr = '';
        if (parts[1]) {
          try {
            addr = vEmail(parts[1], 'email');
          } catch {
            skipped.push({ line, reason: 'invalid_email' });
            addr = '';
          }
        }
        const id = newId('j_');
        insert.run(id, req.competition.id, name, addr, newJudgeToken(), order++, now());
        ids.push(id);
      }
    });
    run();

    touchCompetition(req.competition.id, { db });
    const judges = ids.map((id) => judgeView(req, db.prepare('SELECT * FROM judges WHERE id = ?').get(id), []));
    res.status(201).json({ created: judges.length, skipped, judges });
  }),
);

rosterRouter.patch(
  '/:competitionId/judges/:judgeId',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'judges', req.params.judgeId, req.competition.id, 'Judge');
    const body = req.body || {};
    const name = body.name === undefined ? existing.name : str(body.name, 'name', { required: true, max: 120 });
    const addr =
      body.email === undefined ? existing.email : body.email ? vEmail(body.email, 'email', { required: false }) : '';
    const locale = body.locale === undefined ? existing.locale : body.locale ? oneOf(body.locale, 'locale', LOCALES) : null;

    const update = db.transaction(() => {
      db.prepare('UPDATE judges SET name = ?, email = ?, locale = ? WHERE id = ?').run(name, addr, locale, existing.id);
      if (body.trackIds !== undefined) return setJudgeTracks(db, req.competition.id, existing.id, body.trackIds);
      return db
        .prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?')
        .all(existing.id)
        .map((r) => r.track_id);
    });
    const trackIds = update();

    touchCompetition(req.competition.id, { db });
    res.json({ judge: judgeView(req, db.prepare('SELECT * FROM judges WHERE id = ?').get(existing.id), trackIds) });
  }),
);

rosterRouter.delete(
  '/:competitionId/judges/:judgeId',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'judges', req.params.judgeId, req.competition.id, 'Judge');
    db.prepare('DELETE FROM judges WHERE id = ?').run(existing.id);
    touchCompetition(req.competition.id, { db });
    res.json({ ok: true });
  }),
);

/** Issues a fresh link and invalidates the old one. */
rosterRouter.post(
  '/:competitionId/judges/:judgeId/rotate-link',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'judges', req.params.judgeId, req.competition.id, 'Judge');
    const token = newJudgeToken();
    db.prepare('UPDATE judges SET token = ? WHERE id = ?').run(token, existing.id);
    res.json({ token, link: judgeLink(req, token) });
  }),
);

/** Lets a judge edit again after they marked themselves complete. */
rosterRouter.post(
  '/:competitionId/judges/:judgeId/reopen',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'judges', req.params.judgeId, req.competition.id, 'Judge');
    db.prepare('UPDATE judges SET completed_at = NULL WHERE id = ?').run(existing.id);
    touchCompetition(req.competition.id, { db });
    res.json({ ok: true });
  }),
);

/** Clears one judge's scores and notes without removing them from the panel. */
rosterRouter.post(
  '/:competitionId/judges/:judgeId/reset-scores',
  wrap((req, res) => {
    const db = getDb();
    const existing = mustOwnChild(db, 'judges', req.params.judgeId, req.competition.id, 'Judge');
    const run = db.transaction(() => {
      db.prepare('DELETE FROM scores WHERE judge_id = ?').run(existing.id);
      db.prepare('DELETE FROM notes WHERE judge_id = ?').run(existing.id);
      db.prepare('UPDATE judges SET completed_at = NULL WHERE id = ?').run(existing.id);
    });
    run();
    touchCompetition(req.competition.id, { db });
    res.json({ ok: true });
  }),
);

rosterRouter.post(
  '/:competitionId/judges/reorder',
  wrap((req, res) => {
    applyOrder(getDb(), 'judges', req.competition.id, req.body?.ids);
    touchCompetition(req.competition.id);
    res.json({ ok: true });
  }),
);
