import express from 'express';
import { getDb } from '../db/index.js';
import { forbidden, notFound } from '../lib/errors.js';
import { hub } from '../lib/events.js';
import { noStore, wrap } from '../lib/http.js';
import { boardPayload } from '../services/results.js';

export const publicRouter = express.Router();

/** Resolves the public slug and enforces the organizer's visibility switch. */
function loadBySlug(req, _res, next) {
  const slug = String(req.params.slug || '');
  if (!slug || slug.length > 80) return next(notFound('Leaderboard not found'));
  const competition = getDb().prepare('SELECT * FROM competitions WHERE public_slug = ?').get(slug);
  if (!competition) return next(notFound('Leaderboard not found'));
  if (!competition.public_board) return next(forbidden('This leaderboard is not public'));
  req.competition = competition;
  next();
}

publicRouter.param('slug', (req, res, next) => loadBySlug(req, res, next));

publicRouter.get(
  '/:slug',
  wrap((req, res) => {
    const payload = boardPayload(req.competition.id);
    if (!payload) throw notFound('Leaderboard not found');
    // The board is polled by the demo-room screen as an SSE fallback; a short
    // shared-cache window absorbs a room full of phones hitting refresh.
    res.setHeader('Cache-Control', 'public, max-age=2');
    res.setHeader('ETag', `W/"${req.competition.id}-${payload.rev}"`);
    if (req.headers['if-none-match'] === `W/"${req.competition.id}-${payload.rev}"`) {
      return res.status(304).end();
    }
    res.json(payload);
  }),
);

publicRouter.get(
  '/:slug/live',
  wrap((req, res) => {
    const client = hub.subscribe(req.competition.id, req, res);
    if (!client) {
      // The client falls back to polling /api/board/:slug when this happens.
      res.setHeader('Retry-After', '15');
      return noStore(res)
        .status(503)
        .json({ error: { code: 'live_capacity', message: 'Live update capacity reached' } });
    }
    hub.sendTo(client, 'board', boardPayload(req.competition.id));
  }),
);
