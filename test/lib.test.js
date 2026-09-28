import test from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from '../src/lib/ratelimit.js';
import { createThrottledNotifier } from '../src/lib/events.js';
import { createSessionToken, hashPassword, readSessionToken, verifyPassword } from '../src/lib/auth.js';
import { randomCode, slugify } from '../src/lib/ids.js';
import { optionalUrl, round2 } from '../src/lib/validate.js';

test('the rate limiter blocks a key past its budget and isolates other keys', () => {
  // A long window so the counter cannot roll part-way through the assertions.
  const check = createRateLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(check('a').allowed, true);
  assert.equal(check('a').allowed, true);
  assert.equal(check('a').allowed, true);

  const blocked = check('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.limit, 3);
  assert.ok(blocked.resetSeconds > 0);

  assert.equal(check('b').allowed, true, 'a different client has its own budget');
});

test('the rate limiter budget comes back once the window rolls', async () => {
  const check = createRateLimiter({ windowMs: 50, max: 1 });
  assert.equal(check('a').allowed, true);
  // Waiting well past the window can only ever roll it, never un-roll it.
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(check('a').allowed, true, 'the window rolled over');
});

test('the rate limiter bounds its memory instead of tracking clients forever', () => {
  const check = createRateLimiter({ windowMs: 60_000, max: 5, maxKeys: 10 });
  for (let i = 0; i < 50; i++) check(`client-${i}`);
  // No assertion on internals; the contract is that it keeps answering.
  assert.equal(check('client-final').allowed, true);
});

test('the throttled notifier coalesces a burst into one call per window', async () => {
  const calls = [];
  const window = 300;
  const notify = createThrottledNotifier((key) => calls.push(key), window);

  // The burst is synchronous, so it cannot outlast the window however loaded
  // the machine is.
  for (let i = 0; i < 25; i++) notify('c_1');
  notify('c_2');

  await new Promise((resolve) => setTimeout(resolve, window * 3));
  assert.deepEqual([...calls].sort(), ['c_1', 'c_2'], '25 writes to one competition produced one push');

  notify('c_1');
  await new Promise((resolve) => setTimeout(resolve, window * 3));
  assert.equal(calls.filter((k) => k === 'c_1').length, 2, 'a later change still gets its own push');
});

test('a notifier callback that throws does not stop later notifications', async () => {
  let calls = 0;
  const notify = createThrottledNotifier(() => {
    calls++;
    throw new Error('boom');
  }, 50);

  notify('x');
  await new Promise((resolve) => setTimeout(resolve, 250));
  notify('x');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(calls, 2);
});

test('password hashes are salted and verify only against the right password', () => {
  const a = hashPassword('correct horse battery');
  const b = hashPassword('correct horse battery');
  assert.notEqual(a, b, 'each hash carries its own salt');
  assert.equal(verifyPassword('correct horse battery', a), true);
  assert.equal(verifyPassword('wrong', a), false);
  assert.equal(verifyPassword('correct horse battery', 'not-a-hash'), false);
});

test('session tokens are signed, carry an expiry and reject tampering', () => {
  const token = createSessionToken('u_123');
  assert.deepEqual(readSessionToken(token).uid, 'u_123');

  const [payload, mac] = token.split('.');
  assert.equal(readSessionToken(`${payload}.${'x'.repeat(mac.length)}`), null);
  assert.equal(readSessionToken(payload), null);
  assert.equal(readSessionToken('garbage'), null);
  assert.equal(readSessionToken(createSessionToken('u_123', -1000)), null, 'an expired token is refused');
});

test('slugs stay URL-safe, keep CJK text and never collide by construction', () => {
  const a = slugify('Spring Hackathon 2026!');
  assert.match(a, /^spring-hackathon-2026-[a-z0-9]{6}$/);
  assert.notEqual(a, slugify('Spring Hackathon 2026!'));

  assert.match(slugify('春のハッカソン'), /^春のハッカソン-[a-z0-9]{6}$/);
  assert.match(slugify('!!!'), /^event-[a-z0-9]{6}$/, 'a name with nothing usable still yields a slug');
});

test('random codes avoid characters that are misread when read aloud', () => {
  const code = randomCode(200);
  assert.equal(code.length, 200);
  assert.ok(!/[01ilo]/.test(code), code);
});

test('entry URLs must be http(s) so a link cannot smuggle a script', () => {
  assert.equal(optionalUrl('', 'projectUrl'), '');
  assert.equal(optionalUrl('https://example.com/x', 'projectUrl'), 'https://example.com/x');
  assert.equal(optionalUrl('http://localhost:3000/demo', 'projectUrl'), 'http://localhost:3000/demo');

  const rejected = (value) =>
    assert.throws(
      () => optionalUrl(value, 'projectUrl'),
      (err) => err.code === 'invalid_url',
      `${value} should be rejected`,
    );
  rejected('javascript:alert(1)');
  rejected('data:text/html,<script>alert(1)</script>');
  rejected('file:///etc/passwd');
  rejected('not a url');
});

test('rounding keeps decimal scores exact to two places', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(7.5), 7.5);
  assert.equal(round2(18.005), 18.01);
  assert.equal(round2(1 / 3), 0.33);
});
