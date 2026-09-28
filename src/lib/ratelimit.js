import { tooMany } from './errors.js';

/**
 * Fixed-window counter kept in process memory.
 *
 * Deliberately not a shared store: it exists to blunt accidental hot loops and
 * casual abuse from a single client, not to enforce a global quota. On a
 * scaled-out App Service plan each instance enforces its own window, which is
 * the right trade for a judging session that lasts an afternoon.
 */
export function createRateLimiter({ windowMs = 60_000, max = 600, maxKeys = 20_000 } = {}) {
  let buckets = new Map();
  let windowStart = Date.now();

  function rollIfNeeded(now) {
    if (now - windowStart >= windowMs) {
      buckets = new Map();
      windowStart = now;
    }
  }

  return function check(key) {
    const now = Date.now();
    rollIfNeeded(now);
    // Bound memory: if we are tracking an implausible number of clients the
    // window is almost over anyway, so drop it and start fresh.
    if (buckets.size >= maxKeys && !buckets.has(key)) {
      buckets = new Map();
      windowStart = now;
    }
    const used = (buckets.get(key) || 0) + 1;
    buckets.set(key, used);
    const remaining = Math.max(0, max - used);
    const resetSeconds = Math.ceil((windowStart + windowMs - now) / 1000);
    return { allowed: used <= max, remaining, limit: max, resetSeconds };
  };
}

export function rateLimitMiddleware(options) {
  const check = createRateLimiter(options);
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const result = check(key);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.resetSeconds));
      return next(tooMany());
    }
    next();
  };
}
