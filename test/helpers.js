import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Points the app at a throwaway database and returns a client bound to a
 * freshly listening server. Must be called before importing src/app.js.
 */
export async function startTestServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judgium-test-'));
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  process.env.SESSION_SECRET = 'test-secret-'.repeat(4);
  process.env.NODE_ENV = 'test';

  const { createApp } = await import('../src/app.js');
  const { closeDb } = await import('../src/db/index.js');
  const { hub } = await import('../src/lib/events.js');

  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const jars = new Map();

  function client(name = 'default') {
    if (!jars.has(name)) jars.set(name, { cookie: '' });
    const jar = jars.get(name);

    const call = async (method, urlPath, body) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(jar.cookie ? { cookie: jar.cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookies = res.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        jar.cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
      }
      const type = res.headers.get('content-type') || '';
      const payload = type.includes('application/json')
        ? await res.json().catch(() => null)
        : await res.text();
      return { status: res.status, body: payload, headers: res.headers };
    };

    return {
      base,
      get: (p) => call('GET', p),
      post: (p, b) => call('POST', p, b ?? {}),
      patch: (p, b) => call('PATCH', p, b ?? {}),
      del: (p) => call('DELETE', p),
      raw: (p, init) => fetch(base + p, { ...init, headers: { ...(init?.headers || {}), ...(jar.cookie ? { cookie: jar.cookie } : {}) } }),
    };
  }

  return {
    base,
    client,
    async close() {
      hub.closeAll();
      await new Promise((resolve) => server.close(resolve));
      closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Signs up an organizer and returns their bound client. */
export async function signUpOrganizer(harness, { name = 'default', email = `org-${name}@example.com` } = {}) {
  const c = harness.client(name);
  const res = await c.post('/api/auth/signup', { email, name: `Organizer ${name}`, password: 'a-long-password' });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  return c;
}

/**
 * Signs up an organizer and promotes them to platform administrator.
 *
 * The role is granted straight in SQLite because that is the only way in: the
 * API deliberately has no self-service route to superadmin, and a fresh
 * database has nobody who could grant it.
 */
export async function signUpSuperadmin(harness, { name = 'super', email } = {}) {
  const c = await signUpOrganizer(harness, { name, email });
  const me = await c.get('/api/auth/me');
  const { getDb } = await import('../src/db/index.js');
  getDb().prepare(`UPDATE users SET role = 'superadmin' WHERE id = ?`).run(me.body.user.id);
  return c;
}

/** Creates a competition with a rubric, entries and judges ready to score. */
export async function createFullCompetition(client, { entries = 3, judges = 3, template = 'blank' } = {}) {
  const created = await client.post('/api/competitions', { name: 'Test Hackathon', template });
  const id = created.body.competition.id;

  if (template === 'blank') {
    await client.post(`/api/competitions/${id}/criteria`, { name: 'Blackness', maxScore: 10, weight: 40 });
    await client.post(`/api/competitions/${id}/criteria`, { name: 'Whiteness', maxScore: 15, weight: 60 });
  }

  await client.post(`/api/competitions/${id}/entries/bulk`, {
    text: Array.from({ length: entries }, (_, i) => `Project ${String.fromCharCode(65 + i)}`).join('\n'),
  });
  await client.post(`/api/competitions/${id}/judges/bulk`, {
    text: Array.from({ length: judges }, (_, i) => `Judge ${i + 1} | judge${i + 1}@example.com`).join('\n'),
  });
  await client.patch(`/api/competitions/${id}`, { status: 'live' });

  const detail = await client.get(`/api/competitions/${id}`);
  return detail.body;
}

/** Fills in every criterion of every entry for one judge token. */
export async function scoreAll(harness, token, valueFor) {
  const anon = harness.client(`judge-${token}`);
  const view = await anon.get(`/api/judge/${token}`);
  if (view.status !== 200) throw new Error(`judge view failed: ${JSON.stringify(view.body)}`);
  for (const [entryIndex, entry] of view.body.entries.entries()) {
    const scores = {};
    for (const [criterionIndex, criterionId] of entry.criterionIds.entries()) {
      scores[criterionId] = valueFor(entryIndex, criterionIndex, view.body.criteria.find((c) => c.id === criterionId));
    }
    const res = await anon.patch(`/api/judge/${token}/entries/${entry.id}`, { scores });
    if (res.status !== 200) throw new Error(`score failed: ${JSON.stringify(res.body)}`);
  }
  return anon;
}
