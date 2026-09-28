import { config } from '../config.js';

/** Wraps an async route so rejections reach the Express error handler. */
export const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.then === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

/** Absolute origin for building judge links and the leaderboard URL. */
export function baseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.protocol || 'http';
  const host = req.get('host') || `localhost:${config.port}`;
  return `${proto}://${host}`;
}

export const judgeLink = (req, token) => `${baseUrl(req)}/j/${token}`;
export const boardLink = (req, slug) => `${baseUrl(req)}/board/${slug}`;

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res;
}
