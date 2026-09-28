import express from 'express';
import { config, LOCALES, DEFAULT_LOCALE } from '../config.js';
import { getDb } from '../db/index.js';
import {
  SESSION_COOKIE,
  createSessionToken,
  hashPassword,
  sessionCookieOptions,
  verifyPassword,
} from '../lib/auth.js';
import { accountSuspended, badRequest, conflict, forbidden, invalidCredentials } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { wrap } from '../lib/http.js';
import { email as vEmail, oneOf, str } from '../lib/validate.js';
import { requireUser } from '../middleware/session.js';
import { bootstrapSuperadmins } from '../services/platform.js';

export const authRouter = express.Router();

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  locale: u.locale,
  role: u.role || 'organizer',
});

authRouter.get('/me', (req, res) => {
  res.json({
    user: req.user ? publicUser(req.user) : null,
    // A suspended cookie-holder is not `user`, but telling them why beats
    // bouncing them to a sign-in form that will reject them again.
    suspended: !!req.suspended,
    signupEnabled: !config.disableSignup,
  });
});

authRouter.post(
  '/signup',
  wrap((req, res) => {
    if (config.disableSignup) throw forbidden('Sign-up is disabled on this deployment');

    const addr = vEmail(req.body?.email);
    if (config.signupAllowlist.length > 0 && !config.signupAllowlist.includes(addr)) {
      throw forbidden('This e-mail address is not allowed to create an account here');
    }
    const name = str(req.body?.name, 'name', { required: true, max: 120 });
    const password = String(req.body?.password ?? '');
    if (password.length < 10) {
      throw badRequest('weak_password', 'Password must be at least 10 characters long');
    }
    if (password.length > 512) throw badRequest('weak_password', 'Password is too long');
    const locale = oneOf(req.body?.locale, 'locale', LOCALES, DEFAULT_LOCALE);

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(addr);
    if (existing) throw conflict('email_taken', 'An account with that e-mail already exists');

    const user = {
      id: newId('u_'),
      email: addr,
      name,
      password_hash: hashPassword(password),
      locale,
      role: 'organizer',
      status: 'active',
      created_at: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, locale, role, status, created_at)
       VALUES (@id, @email, @name, @password_hash, @locale, @role, @status, @created_at)`,
    ).run(user);

    // Signing up with an address listed in SUPERADMIN_EMAILS grants the role
    // now, so the order of "deploy" and "create my account" does not matter.
    if (bootstrapSuperadmins(db, config.superadminEmails.filter((e) => e === addr)).length > 0) {
      user.role = 'superadmin';
    }

    res.cookie(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions(req));
    res.status(201).json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  wrap((req, res) => {
    const addr = vEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(addr);
    // Same error either way so the endpoint cannot enumerate accounts.
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw invalidCredentials();
    }
    // Checked after the password so a suspension is not an oracle for which
    // addresses have accounts.
    if (user.status === 'suspended') throw accountSuspended();

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    res.cookie(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions(req));
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(req), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.patch(
  '/me',
  requireUser,
  wrap((req, res) => {
    const db = getDb();
    const name = req.body?.name === undefined ? req.user.name : str(req.body.name, 'name', { required: true, max: 120 });
    const locale = oneOf(req.body?.locale, 'locale', LOCALES, req.user.locale);
    db.prepare('UPDATE users SET name = ?, locale = ? WHERE id = ?').run(name, locale, req.user.id);
    res.json({ user: { ...publicUser(req.user), name, locale } });
  }),
);

authRouter.post(
  '/password',
  requireUser,
  wrap((req, res) => {
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '');
    if (next.length < 10) throw badRequest('weak_password', 'Password must be at least 10 characters long');
    const db = getDb();
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(current, row.password_hash)) throw invalidCredentials('Current password is incorrect');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    res.json({ ok: true });
  }),
);
