import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { config, DEFAULT_LOCALE, LOCALES } from './config.js';
import { getDb } from './db/index.js';
import { HttpError, notFound } from './lib/errors.js';
import { hub } from './lib/events.js';
import { baseUrl, noStore } from './lib/http.js';
import { rateLimitMiddleware } from './lib/ratelimit.js';
import { templateList } from './lib/templates.js';
import { attachUser, parseCookies } from './middleware/session.js';
import { authRouter } from './routes/auth.js';
import { competitionsRouter } from './routes/competitions.js';
import { exportsRouter } from './routes/exports.js';
import { judgeRouter } from './routes/judge.js';
import { participantRouter } from './routes/participant.js';
import { publicRouter } from './routes/public.js';
import { rosterRouter } from './routes/roster.js';
import { sysadminRouter } from './routes/sysadmin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

export function createApp() {
  const app = express();

  // Azure App Service terminates TLS at its front end and forwards
  // X-Forwarded-For / X-Forwarded-Proto. Trusting one hop makes req.ip and
  // req.secure correct without trusting arbitrary client headers.
  app.set('trust proxy', 1);
  app.set('x-powered-by', false);
  app.set('etag', false);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  // Liveness/readiness probe. Kept before rate limiting so Azure's health
  // check is never throttled.
  app.get('/healthz', (_req, res) => {
    let dbOk = true;
    try {
      getDb().prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    noStore(res)
      .status(dbOk ? 200 : 503)
      .json({
        status: dbOk ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(process.uptime()),
        live: hub.stats,
        version: process.env.WEBSITE_SITE_NAME ? 'azure' : config.env,
      });
  });

  // AGPL-3.0 section 13 requires that every user who interacts with this
  // program over a network be offered its corresponding source. Each page
  // footer links here rather than to a hard-coded host, so an operator running
  // a modified build satisfies the licence by setting SOURCE_URL.
  app.get('/source', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.redirect(302, config.sourceUrl);
  });

  app.use(express.json({ limit: config.capacity.jsonBodyLimit }));
  app.use(parseCookies);
  app.use(attachUser);

  const readLimiter = rateLimitMiddleware({ max: config.capacity.rateLimitRead });
  const writeLimiter = rateLimitMiddleware({ max: config.capacity.rateLimitWrite });

  app.use('/api', (req, res, next) =>
    (req.method === 'GET' || req.method === 'HEAD' ? readLimiter : writeLimiter)(req, res, next),
  );

  app.get('/api/meta', (req, res) => {
    noStore(res).json({
      locales: LOCALES,
      defaultLocale: DEFAULT_LOCALE,
      templates: templateList(),
      limits: config.limits,
      capacity: {
        maxLiveClients: config.capacity.maxLiveClients,
        liveClients: hub.stats.clients,
        leaderboardThrottleMs: config.capacity.leaderboardThrottleMs,
      },
      baseUrl: baseUrl(req),
      signupEnabled: !config.disableSignup,
      // The section 13 source offer, for API consumers rather than the pages.
      license: 'AGPL-3.0-only',
      sourceUrl: config.sourceUrl,
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/competitions', competitionsRouter);
  app.use('/api/competitions', rosterRouter);
  app.use('/api/competitions', exportsRouter);
  app.use('/api/judge', judgeRouter);
  app.use('/api/enter', participantRouter);
  app.use('/api/board', publicRouter);
  app.use('/api/sysadmin', sysadminRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unknown API endpoint')));

  // --- static assets and pages -------------------------------------------

  app.use(
    express.static(publicDir, {
      index: false,
      extensions: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(css|js|json|png|svg|woff2?)$/.test(filePath)) {
          // Assets are versioned by the ?v= query the pages append on release.
          res.setHeader('Cache-Control', 'public, max-age=300');
        }
      },
    }),
  );

  const page = (file) => (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, file));
  };

  app.get('/', page('index.html'));
  app.get('/login', page('index.html'));
  app.get('/signup', page('index.html'));
  app.get('/admin', page('admin.html'));
  // Express 5 / path-to-regexp v8 requires a named wildcard.
  app.get('/admin/*splat', page('admin.html'));
  // The shell is served to anyone; every byte of data behind it is gated by
  // requireSuperadmin, and the page redirects a non-superadmin to /admin.
  app.get('/sysadmin', page('sysadmin.html'));
  app.get('/sysadmin/*splat', page('sysadmin.html'));
  app.get('/j/:token', page('judge.html'));
  app.get('/enter/:slug', page('enter.html'));
  app.get('/board/:slug', page('board.html'));

  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(404).sendFile(path.join(publicDir, '404.html'));
    }
    next(notFound());
  });

  // --- error handling ----------------------------------------------------

  app.use((err, req, res, _next) => {
    if (res.headersSent) {
      // An SSE stream or a file download already started; just drop it.
      try {
        res.end();
      } catch {
        /* nothing more to do */
      }
      return;
    }

    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) {
      console.error('[error]', req.method, req.originalUrl, err);
    }

    const body = {
      error: {
        code: err instanceof HttpError ? err.code : 'internal_error',
        message: status >= 500 ? 'Something went wrong on our side' : err.message,
      },
    };
    if (err instanceof HttpError && err.details) body.error.details = err.details;

    noStore(res).status(status).json(body);
  });

  return app;
}
