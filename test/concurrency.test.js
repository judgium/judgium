import test from 'node:test';
import assert from 'node:assert/strict';

import { signUpOrganizer, startTestServer } from './helpers.js';

const harness = await startTestServer();
test.after(() => harness.close());

/** Builds a competition with the given roster size. */
async function build(org, { entries, judges, criteria = 4 }) {
  const created = await org.post('/api/competitions', { name: 'Load Test', template: 'blank' });
  const id = created.body.competition.id;
  for (let i = 0; i < criteria; i++) {
    await org.post(`/api/competitions/${id}/criteria`, { name: `Criterion ${i + 1}`, maxScore: 10, weight: 25 });
  }
  await org.post(`/api/competitions/${id}/entries/bulk`, {
    text: Array.from({ length: entries }, (_, i) => `Entry ${i + 1}`).join('\n'),
  });
  await org.post(`/api/competitions/${id}/judges/bulk`, {
    text: Array.from({ length: judges }, (_, i) => `Judge ${i + 1}`).join('\n'),
  });
  await org.patch(`/api/competitions/${id}`, { status: 'live' });
  return (await org.get(`/api/competitions/${id}`)).body;
}

test('a full panel scoring at the same time loses no writes', async () => {
  const org = await signUpOrganizer(harness, { name: 'panel' });
  const judges = 15;
  const entries = 20;
  const data = await build(org, { entries, judges });

  // Every judge scores every entry, all panels firing concurrently. This is
  // the write pattern of a real demo session compressed into a few seconds.
  const work = data.judges.map(async (judge, judgeIndex) => {
    const client = harness.client(`load-judge-${judgeIndex}`);
    const view = await client.get(`/api/judge/${judge.token}`);
    assert.equal(view.status, 200);
    for (const entry of view.body.entries) {
      const scores = Object.fromEntries(entry.criterionIds.map((id, i) => [id, ((judgeIndex + i) % 10) + 1]));
      const res = await client.patch(`/api/judge/${judge.token}/entries/${entry.id}`, { scores });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    return client.post(`/api/judge/${judge.token}/complete`);
  });

  const completions = await Promise.all(work);
  for (const res of completions) assert.equal(res.status, 200, JSON.stringify(res.body));

  const results = await org.get(`/api/competitions/${data.competition.id}/results`);
  assert.equal(results.body.stats.judgesCompleted, judges);
  assert.equal(
    results.body.stats.filledCells,
    entries * judges * 4,
    'every judge x entry x criterion cell was persisted',
  );
  for (const row of results.body.rows) {
    assert.equal(row.judgesScored, judges);
    assert.equal(row.judgeScores.length, judges);
  }
});

test('concurrent writes to the same scorecard converge on the last value', async () => {
  const org = await signUpOrganizer(harness, { name: 'converge' });
  const data = await build(org, { entries: 1, judges: 1, criteria: 2 });
  const token = data.judges[0].token;
  const client = harness.client('converge-judge');
  const entry = (await client.get(`/api/judge/${token}`)).body.entries[0];
  const [first, second] = entry.criterionIds;

  // A judge tabbing fast produces overlapping PATCHes for different criteria;
  // both must land rather than one clobbering the other.
  await Promise.all([
    client.patch(`/api/judge/${token}/entries/${entry.id}`, { scores: { [first]: 3 } }),
    client.patch(`/api/judge/${token}/entries/${entry.id}`, { scores: { [second]: 4 } }),
  ]);

  const view = await client.get(`/api/judge/${token}`);
  assert.equal(view.body.entries[0].scores[first], 3);
  assert.equal(view.body.entries[0].scores[second], 4);
  assert.equal(view.body.entries[0].total, 7);
});

test('many simultaneous board viewers all receive the live stream', async () => {
  const org = await signUpOrganizer(harness, { name: 'viewers' });
  const data = await build(org, { entries: 3, judges: 1, criteria: 2 });
  const slug = data.competition.slug;

  const viewers = 40;
  const controllers = [];
  const firstFrames = await Promise.all(
    Array.from({ length: viewers }, async () => {
      const controller = new AbortController();
      controllers.push(controller);
      const res = await fetch(`${harness.base}/api/board/${slug}/live`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
      assert.equal(res.status, 200);
      const chunk = new TextDecoder().decode((await res.body.getReader().read()).value);
      return chunk;
    }),
  );

  for (const frame of firstFrames) assert.match(frame, /event: board/);

  const health = await harness.client('anon').get('/healthz');
  assert.ok(health.body.live.clients >= viewers, `expected >= ${viewers} live clients, saw ${health.body.live.clients}`);
  assert.equal(health.body.live.rejectedConnections, 0);

  for (const controller of controllers) controller.abort();

  // Sockets are released once the client goes away, so the ceiling is not
  // consumed by abandoned tabs.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const after = await harness.client('anon').get('/healthz');
  assert.ok(after.body.live.clients < viewers, `clients should drain, saw ${after.body.live.clients}`);
});

test('a large roster still renders one leaderboard payload quickly', async () => {
  const org = await signUpOrganizer(harness, { name: 'large' });
  const entries = 250;
  const data = await build(org, { entries, judges: 4, criteria: 6 });

  // One judge scores everything, then we time a cold (cache-busted) recompute.
  const client = harness.client('large-judge');
  const view = await client.get(`/api/judge/${data.judges[0].token}`);
  for (const entry of view.body.entries) {
    await client.patch(`/api/judge/${data.judges[0].token}/entries/${entry.id}`, {
      scores: Object.fromEntries(entry.criterionIds.map((id, i) => [id, i + 1])),
    });
  }

  const started = performance.now();
  const board = await harness.client('anon').get(`/api/board/${data.competition.slug}`);
  const elapsed = performance.now() - started;

  assert.equal(board.status, 200);
  assert.equal(board.body.rows.length, entries);
  assert.ok(elapsed < 5000, `leaderboard for ${entries} entries took ${elapsed.toFixed(0)}ms`);

  // The cached second read must be far cheaper than the first.
  const cachedStart = performance.now();
  await harness.client('anon').get(`/api/board/${data.competition.slug}`);
  const cachedElapsed = performance.now() - cachedStart;
  assert.ok(cachedElapsed < 1500, `cached read took ${cachedElapsed.toFixed(0)}ms`);
  assert.ok(cachedElapsed <= elapsed, 'the cached read must not be slower than the cold one');
});

test('the live-client ceiling is enforced rather than exhausting the process', async () => {
  const { hub } = await import('../src/lib/events.js');
  const org = await signUpOrganizer(harness, { name: 'ceiling' });
  const data = await build(org, { entries: 1, judges: 1, criteria: 1 });

  const original = hub.maxClients;
  hub.maxClients = hub.clientCount; // pretend we are full
  try {
    const res = await fetch(`${harness.base}/api/board/${data.competition.slug}/live`, {
      headers: { accept: 'text/event-stream' },
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'live_capacity');
    assert.equal(res.headers.get('retry-after'), '15');
    assert.ok(hub.stats.rejectedConnections > 0);
  } finally {
    hub.maxClients = original;
  }

  // Polling still works while the stream is unavailable, which is what the
  // client falls back to.
  const board = await harness.client('anon').get(`/api/board/${data.competition.slug}`);
  assert.equal(board.status, 200);
});
