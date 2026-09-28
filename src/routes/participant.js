/** Participant self-submission, served at /api/enter/:slug.
 *
 *  A participant reaches a competition through the link its organizer shares -
 *  the same shape as the public board and a judge link, so nothing has to list
 *  competitions publicly for submission to work. The slug is the only thing a
 *  participant needs to know, and an account created here can submit to any
 *  other competition whose link it is given.
 *
 *  Deliberately absent, because the organizer asked for none of it:
 *    - no cap on how many entries one account submits to one competition;
 *      hackathons that allow several attempts per team are normal;
 *    - no duplicate detection, for the same reason;
 *    - no approval step. A judge who decides an entry is not worth scoring
 *      leaves it untouched, and scoring.js drops a judge with no values at all
 *      from that entry, so skipping costs the entry nothing but leaves it
 *      unranked if every judge skips it.
 */
import express from 'express';

import { config, LOCALES, DEFAULT_LOCALE } from '../config.js';
import { getDb } from '../db/index.js';
import {
  SESSION_COOKIE,
  createSessionToken,
  hashPassword,
  sessionCookieOptions,
} from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { wrap } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { email as vEmail, oneOf, optionalUrl, str } from '../lib/validate.js';
import { touchCompetition } from '../services/results.js';
import { nextSortOrder } from '../middleware/competition.js';
import { isParticipant, requireParticipant } from '../middleware/session.js';
import { publicUser } from './auth.js';

export const participantRouter = express.Router();

const now = () => new Date().toISOString();

/**
 * Loads :slug. Unlike the organizer routes this is not ownership-scoped - the
 * slug is meant to be shared - but a competition that has never opened
 * submissions answers 404 rather than admitting it exists, so an organizer who
 * has not opened the window has not published anything.
 */
function loadOpenableCompetition(req, _res, next) {
  const row = getDb().prepare('SELECT * FROM competitions WHERE public_slug = ?').get(req.params.slug);
  if (!row) return next(notFound('No competition with that submission link'));
  req.competition = row;
  next();
}

/** Writes are refused once the organizer closes the window. This is the deadline. */
function requireSubmissionsOpen(req, _res, next) {
  if (!req.competition.submissions_open) {
    return next(forbidden('Submissions for this competition are closed'));
  }
  if (req.competition.status === 'closed') {
    return next(forbidden('This competition is closed'));
  }
  next();
}

const entryView = (e) => ({
  id: e.id,
  trackId: e.track_id,
  name: e.name,
  teamName: e.team_name,
  description: e.description,
  projectUrl: e.project_url,
  videoUrl: e.video_url,
  createdAt: e.created_at,
});

const competitionView = (c) => ({
  name: c.name,
  description: c.description,
  slug: c.public_slug,
  submissionsOpen: !!c.submissions_open && c.status !== 'closed',
  status: c.status,
});

/**
 * Entry fields a participant controls. Narrower than the organizer's payload on
 * purpose: table_label is where an organizer seats a team in the demo room, and
 * a submitter has no business setting it.
 */
const submissionPayload = (db, competitionId, body, existing) => {
  const trackId =
    body.trackId === undefined
      ? (existing?.track_id ?? null)
      : resolveOpenTrack(db, competitionId, body.trackId);
  return {
    track_id: trackId,
    name: body.name === undefined && existing ? existing.name : str(body.name, 'name', { required: true }),
    team_name: body.teamName === undefined && existing ? existing.team_name : str(body.teamName, 'teamName'),
    description:
      body.description === undefined && existing
        ? existing.description
        : str(body.description, 'description', { max: config.limits.descriptionMaxLength }),
    project_url:
      body.projectUrl === undefined && existing ? existing.project_url : optionalUrl(body.projectUrl, 'projectUrl'),
    video_url: body.videoUrl === undefined && existing ? existing.video_url : optionalUrl(body.videoUrl, 'videoUrl'),
  };
};

/** A participant may only pick a track that already exists here; unlike the
 *  organizer's bulk import, submitting cannot invent one. */
function resolveOpenTrack(db, competitionId, value) {
  if (value === undefined || value === null || value === '') return null;
  const id = str(value, 'trackId', { max: 64 });
  const row = db.prepare('SELECT id FROM tracks WHERE id = ? AND competition_id = ?').get(id, competitionId);
  if (!row) throw badRequest('unknown_track', 'That track does not belong to this competition');
  return row.id;
}

participantRouter.param('slug', (req, res, next) => loadOpenableCompetition(req, res, next));

/**
 * The page's only read. Answers without a session so the sign-in form can name
 * the competition, and adds the caller's own entries when they have one.
 */
participantRouter.get(
  '/:slug',
  wrap((req, res) => {
    const db = getDb();
    const body = {
      competition: competitionView(req.competition),
      tracks: db
        .prepare('SELECT id, name FROM tracks WHERE competition_id = ? ORDER BY sort_order, name')
        .all(req.competition.id),
      user: req.user ? publicUser(req.user) : null,
      suspended: !!req.suspended,
      entries: [],
      limits: { descriptionMaxLength: config.limits.descriptionMaxLength, urlMaxLength: config.limits.urlMaxLength },
    };
    if (req.user && isParticipant(req.user)) {
      body.entries = db
        .prepare('SELECT * FROM entries WHERE competition_id = ? AND submitted_by = ? ORDER BY sort_order, created_at')
        .all(req.competition.id, req.user.id)
        .map(entryView);
    }
    res.json(body);
  }),
);

/**
 * Participant sign-up, reachable only through an open competition's link. That
 * is the whole gate on account creation here: there is no public participant
 * registration page, so an organizer who has not opened submissions cannot have
 * accounts created against their competition. DISABLE_SIGNUP and
 * SIGNUP_ALLOWLIST are not consulted - they govern organizer registration, and
 * an operator who closed that did not thereby close their events to entrants.
 */
participantRouter.post(
  '/:slug/signup',
  requireSubmissionsOpen,
  wrap((req, res) => {
    const addr = vEmail(req.body?.email);
    const name = str(req.body?.name, 'name', { required: true, max: 120 });
    const password = String(req.body?.password ?? '');
    if (password.length < 10) throw badRequest('weak_password', 'Password must be at least 10 characters long');
    if (password.length > 512) throw badRequest('weak_password', 'Password is too long');
    const locale = oneOf(req.body?.locale, 'locale', LOCALES, DEFAULT_LOCALE);

    const db = getDb();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(addr)) {
      throw conflict('email_taken', 'An account with that e-mail already exists. Sign in instead.');
    }

    const user = {
      id: newId('u_'),
      email: addr,
      name,
      password_hash: hashPassword(password),
      locale,
      role: 'participant',
      status: 'active',
      created_at: now(),
    };
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, locale, role, status, created_at)
       VALUES (@id, @email, @name, @password_hash, @locale, @role, @status, @created_at)`,
    ).run(user);

    res.cookie(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions(req));
    res.status(201).json({ user: publicUser(user) });
  }),
);

participantRouter.post(
  '/:slug/entries',
  requireParticipant,
  requireSubmissionsOpen,
  wrap((req, res) => {
    const db = getDb();
    const data = submissionPayload(db, req.competition.id, req.body || {}, null);
    const id = newId('e_');
    db.prepare(
      `INSERT INTO entries (id, competition_id, track_id, name, team_name, description, project_url,
                            video_url, table_label, submitted_by, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    ).run(
      id,
      req.competition.id,
      data.track_id,
      data.name,
      data.team_name,
      data.description,
      data.project_url,
      data.video_url,
      req.user.id,
      nextSortOrder(db, 'entries', req.competition.id),
      now(),
    );
    touchCompetition(req.competition.id, { db });
    res.status(201).json({ entry: entryView(db.prepare('SELECT * FROM entries WHERE id = ?').get(id)) });
  }),
);

/** Loads an entry the caller submitted. Someone else's entry reads as missing. */
function ownEntry(db, req) {
  const row = db
    .prepare('SELECT * FROM entries WHERE id = ? AND competition_id = ? AND submitted_by = ?')
    .get(req.params.entryId, req.competition.id, req.user.id);
  if (!row) throw notFound('Entry not found');
  return row;
}

participantRouter.patch(
  '/:slug/entries/:entryId',
  requireParticipant,
  requireSubmissionsOpen,
  wrap((req, res) => {
    const db = getDb();
    const existing = ownEntry(db, req);
    const data = submissionPayload(db, req.competition.id, req.body || {}, existing);
    db.prepare(
      `UPDATE entries SET track_id = ?, name = ?, team_name = ?, description = ?, project_url = ?, video_url = ?
       WHERE id = ?`,
    ).run(data.track_id, data.name, data.team_name, data.description, data.project_url, data.video_url, existing.id);
    touchCompetition(req.competition.id, { db });
    res.json({ entry: entryView(db.prepare('SELECT * FROM entries WHERE id = ?').get(existing.id)) });
  }),
);

/**
 * Withdrawing an entry is allowed only while the window is open, which is what
 * requireSubmissionsOpen already enforces. After the deadline a submission is
 * part of the event: scores may already hang off it, and removing it mid-judging
 * would take a judge's work with it.
 */
participantRouter.delete(
  '/:slug/entries/:entryId',
  requireParticipant,
  requireSubmissionsOpen,
  wrap((req, res) => {
    const db = getDb();
    const existing = ownEntry(db, req);
    db.prepare('DELETE FROM entries WHERE id = ?').run(existing.id);
    touchCompetition(req.competition.id, { db });
    res.status(204).end();
  }),
);
