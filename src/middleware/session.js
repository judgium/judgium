import { getDb } from '../db/index.js';
import { SESSION_COOKIE, readSessionToken } from '../lib/auth.js';
import { accountSuspended, forbidden, unauthorized } from '../lib/errors.js';

/** Minimal cookie parser - avoids pulling in cookie-parser for one header. */
export function parseCookies(req, _res, next) {
  const header = req.headers.cookie;
  const jar = {};
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const key = part.slice(0, eq).trim();
      if (!key || key in jar) continue;
      try {
        jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        jar[key] = part.slice(eq + 1).trim();
      }
    }
  }
  req.cookies = jar;
  next();
}

export function attachUser(req, _res, next) {
  req.user = null;
  req.suspended = false;
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? readSessionToken(token) : null;
  if (session) {
    const user = getDb()
      .prepare('SELECT id, email, name, locale, role, status, last_login_at, created_at FROM users WHERE id = ?')
      .get(session.uid);
    if (user) {
      // A suspension takes effect on the next request rather than when the
      // cookie expires, so req.user stays empty and the account reads as
      // signed out everywhere except the dedicated error below.
      if (user.status === 'suspended') req.suspended = true;
      else req.user = user;
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (req.suspended) return next(accountSuspended());
  if (!req.user) return next(unauthorized());
  next();
}

export const isSuperadmin = (user) => user?.role === 'superadmin';
export const isParticipant = (user) => user?.role === 'participant';

/**
 * Gate for everything an organizer owns.
 *
 * Competition-scoped routes are already safe: loadOwnedCompetition compares
 * owner_id and answers 404. The routes that are not scoped to one competition
 * are the hole this closes - without it a participant account could POST
 * /api/competitions and run a competition of its own, having signed up through
 * a submission link. A participant is told 403 rather than 404 because, unlike
 * a competition id, the route is not a secret.
 */
export function requireOrganizer(req, _res, next) {
  if (req.suspended) return next(accountSuspended());
  if (!req.user) return next(unauthorized());
  if (isParticipant(req.user)) {
    return next(forbidden('This account can only submit entries'));
  }
  next();
}

/** Gate for the participant submission API. */
export function requireParticipant(req, _res, next) {
  if (req.suspended) return next(accountSuspended());
  if (!req.user) return next(unauthorized());
  if (!isParticipant(req.user)) {
    return next(forbidden('Sign in with a participant account to submit entries'));
  }
  next();
}

/** Gate for the cross-tenant platform administration API. */
export function requireSuperadmin(req, _res, next) {
  if (req.suspended) return next(accountSuspended());
  if (!req.user) return next(unauthorized());
  if (!isSuperadmin(req.user)) {
    // 403 rather than 404: the route is public knowledge, the privilege is not.
    return next(forbidden('Platform administrator access is required'));
  }
  next();
}
