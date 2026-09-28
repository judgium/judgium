import crypto from 'node:crypto';
import { config } from '../config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(data) {
  return crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');
}

export function createSessionToken(userId, ttlMs = config.sessionTtlMs) {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + ttlMs }));
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.', 2);
  const expected = sign(payload);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.uid || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'judgium_session';

export function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Azure App Service terminates TLS at the front end and forwards
    // X-Forwarded-Proto; req.secure reflects that once trust proxy is on.
    secure: req.secure || config.env === 'production',
    maxAge: config.sessionTtlMs,
    path: '/',
  };
}
