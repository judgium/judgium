import test from 'node:test';
import assert from 'node:assert/strict';

import { createFullCompetition, scoreAll, signUpOrganizer, startTestServer } from './helpers.js';

const harness = await startTestServer();
test.after(() => harness.close());

test('health check reports the database and live-client capacity', async () => {
  const res = await harness.client('anon').get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.ok(res.body.live.maxClients > 0, 'capacity is sized from the host, never zero');
});

test('the AGPL section 13 source offer is reachable and advertised', async () => {
  const anon = harness.client('anon-source');

  // Section 13 obliges an operator to offer the corresponding source to every
  // user who interacts with the program over a network, so /source must answer
  // without a session and without being swallowed by rate limiting.
  const res = await anon.raw('/source', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^https?:\/\//, 'must redirect to an absolute source URL');

  const meta = await anon.get('/api/meta');
  assert.equal(meta.body.license, 'AGPL-3.0-only');
  assert.equal(meta.body.sourceUrl, res.headers.get('location'));

  // Every surface a user can reach has to carry the link, not just the landing
  // page - a judge who only ever sees /j/<token> is a section 13 user too.
  for (const page of ['/', '/admin', '/sysadmin', '/j/nonexistent-token', '/board/nonexistent-slug']) {
    const html = await (await anon.raw(page, { headers: { accept: 'text/html' } })).text();
    assert.match(html, /data-source-link/, `${page} must offer the source`);
    assert.match(html, /href="\/source"/, `${page} must link to /source`);
  }
});

test('sign-up, session and duplicate e-mail handling', async () => {
  const c = harness.client('signup');
  const first = await c.post('/api/auth/signup', {
    email: 'Dup@Example.com',
    name: 'Org',
    password: 'a-long-password',
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.user.email, 'dup@example.com', 'e-mails are normalised to lower case');

  const me = await c.get('/api/auth/me');
  assert.equal(me.body.user.email, 'dup@example.com');

  const again = await harness.client('signup2').post('/api/auth/signup', {
    email: 'dup@example.com',
    name: 'Other',
    password: 'a-long-password',
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'email_taken');
});

test('short passwords are rejected', async () => {
  const res = await harness.client('weak').post('/api/auth/signup', {
    email: 'weak@example.com',
    name: 'Weak',
    password: 'short',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'weak_password');
});

test('login with a wrong password gives the same error as an unknown account', async () => {
  const unknown = await harness.client('anon').post('/api/auth/login', {
    email: 'nobody@example.com',
    password: 'a-long-password',
  });
  const wrong = await harness.client('anon').post('/api/auth/login', {
    email: 'dup@example.com',
    password: 'wrong-password-here',
  });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(unknown.body.error.message, wrong.body.error.message);
});

test('creating a competition from a template seeds the rubric', async () => {
  const org = await signUpOrganizer(harness, { name: 'template' });
  const created = await org.post('/api/competitions', { name: 'Rubric Test', template: 'general' });
  assert.equal(created.status, 201);

  const detail = await org.get(`/api/competitions/${created.body.competition.id}`);
  assert.equal(detail.body.criteria.length, 6);
  assert.deepEqual(
    detail.body.criteria.map((c) => c.weight),
    [25, 20, 20, 15, 10, 10],
  );
  assert.ok(detail.body.boardUrl.endsWith(`/board/${detail.body.competition.slug}`));
});

test('an unknown template is rejected instead of silently creating nothing', async () => {
  const org = await signUpOrganizer(harness, { name: 'badtemplate' });
  const res = await org.post('/api/competitions', { name: 'X', template: 'does-not-exist' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'unknown_template');
});

test('bulk import creates entries, infers tracks and reports skipped lines', async () => {
  const org = await signUpOrganizer(harness, { name: 'bulk' });
  const created = await org.post('/api/competitions', { name: 'Bulk', template: 'blank' });
  const id = created.body.competition.id;

  const res = await org.post(`/api/competitions/${id}/entries/bulk`, {
    text: 'Project A | Team Alpha | Best AI | T1\nProject B\n | oops-no-name\nProject C | Team Gamma | Best AI',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.created, 3);
  assert.equal(res.body.skipped.length, 1);
  assert.equal(res.body.skipped[0].reason, 'missing_name');

  const detail = await org.get(`/api/competitions/${id}`);
  assert.equal(detail.body.tracks.length, 1, 'the "Best AI" track was created once, not twice');
  assert.equal(detail.body.tracks[0].name, 'Best AI');
  const withTrack = detail.body.entries.filter((e) => e.trackId);
  assert.equal(withTrack.length, 2);
});

test('a judge scores through their private link and the leaderboard follows', async () => {
  const org = await signUpOrganizer(harness, { name: 'flow' });
  const data = await createFullCompetition(org, { entries: 3, judges: 2 });
  const id = data.competition.id;

  const view = await harness.client('j1').get(`/api/judge/${data.judges[0].token}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.entries.length, 3);
  assert.equal(view.body.writable, true);
  assert.deepEqual(view.body.progress, { scored: 0, complete: 0, total: 3 });
  assert.equal(view.body.judge.name, 'Judge 1');
  assert.ok(!('token' in view.body.judge), 'the judge payload does not echo the bearer token');

  // Judge 1 gives Project A 10 + 8 = 18, matching the design mock-up.
  const entryA = view.body.entries[0];
  const [blackness, whiteness] = entryA.criterionIds;
  const saved = await harness
    .client('j1')
    .patch(`/api/judge/${data.judges[0].token}/entries/${entryA.id}`, {
      scores: { [blackness]: 10, [whiteness]: 8 },
      notes: 'Great execution.',
    });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.entry.total, 18);
  assert.equal(saved.body.entry.complete, true);
  assert.deepEqual(saved.body.progress, { scored: 1, complete: 1, total: 3 });

  const board = await harness.client('anon').get(`/api/board/${data.competition.slug}`);
  assert.equal(board.status, 200);
  assert.equal(board.body.rows[0].name, 'Project A');
  assert.equal(board.body.rows[0].score, 18);
  assert.equal(board.body.rows[0].rank, 1);
  assert.equal(board.body.rows[1].score, null);
  assert.equal(board.body.rows[1].rank, null, 'unscored entries have no rank, like the mock-up');
  assert.ok(!JSON.stringify(board.body).includes('Judge 1'), 'the public board never names judges');
  assert.ok(!JSON.stringify(board.body).includes('Great execution'), 'the public board never leaks notes');
});

test('clearing a score removes it rather than storing a zero', async () => {
  const org = await signUpOrganizer(harness, { name: 'clear' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;
  const client = harness.client('clear-judge');

  const view = await client.get(`/api/judge/${token}`);
  const entry = view.body.entries[0];
  const [first, second] = entry.criterionIds;

  await client.patch(`/api/judge/${token}/entries/${entry.id}`, { scores: { [first]: 5, [second]: 5 } });
  const cleared = await client.patch(`/api/judge/${token}/entries/${entry.id}`, { scores: { [first]: null } });

  assert.equal(cleared.body.entry.scores[first], null);
  assert.equal(cleared.body.entry.filled, 1);
  assert.equal(cleared.body.entry.complete, false);
  assert.deepEqual(cleared.body.progress, { scored: 1, complete: 0, total: 1 });
});

test('scores outside a criterion range and unknown criteria are refused', async () => {
  const org = await signUpOrganizer(harness, { name: 'range' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;
  const client = harness.client('range-judge');
  const view = await client.get(`/api/judge/${token}`);
  const entry = view.body.entries[0];

  const tooHigh = await client.patch(`/api/judge/${token}/entries/${entry.id}`, {
    scores: { [entry.criterionIds[0]]: 11 },
  });
  assert.equal(tooHigh.status, 400);
  assert.equal(tooHigh.body.error.code, 'out_of_range');

  const negative = await client.patch(`/api/judge/${token}/entries/${entry.id}`, {
    scores: { [entry.criterionIds[0]]: -1 },
  });
  assert.equal(negative.status, 400);

  const unknown = await client.patch(`/api/judge/${token}/entries/${entry.id}`, {
    scores: { k_not_a_real_criterion: 5 },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'unknown_criterion');
});

test('marking complete requires a full scorecard unless forced', async () => {
  const org = await signUpOrganizer(harness, { name: 'complete' });
  const data = await createFullCompetition(org, { entries: 2, judges: 1 });
  const token = data.judges[0].token;
  const client = harness.client('complete-judge');

  const view = await client.get(`/api/judge/${token}`);
  const entry = view.body.entries[0];
  await client.patch(`/api/judge/${token}/entries/${entry.id}`, {
    scores: Object.fromEntries(entry.criterionIds.map((id) => [id, 5])),
  });

  const rejected = await client.post(`/api/judge/${token}/complete`);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, 'incomplete_scorecard');
  assert.equal(rejected.body.error.details.unfinished.length, 1);
  assert.equal(rejected.body.error.details.unfinished[0].name, 'Project B');

  const forced = await client.post(`/api/judge/${token}/complete`, { force: true });
  assert.equal(forced.status, 200);

  // A completed scorecard is read-only until it is reopened.
  const blocked = await client.patch(`/api/judge/${token}/entries/${entry.id}`, {
    scores: { [entry.criterionIds[0]]: 1 },
  });
  assert.equal(blocked.status, 403);

  assert.equal((await client.post(`/api/judge/${token}/reopen`)).status, 200);
  assert.equal(
    (await client.patch(`/api/judge/${token}/entries/${entry.id}`, { scores: { [entry.criterionIds[0]]: 1 } })).status,
    200,
  );
});

test('drop high/low changes the leaderboard without touching stored scores', async () => {
  const org = await signUpOrganizer(harness, { name: 'drop' });
  const data = await createFullCompetition(org, { entries: 1, judges: 3 });
  const id = data.competition.id;

  // Judge totals of 5, 15 and 25 over two criteria (max 10 and 15).
  const totals = [
    [2, 3],
    [6, 9],
    [10, 15],
  ];
  for (const [index, judge] of data.judges.entries()) {
    await scoreAll(harness, judge.token, (_e, criterionIndex) => totals[index][criterionIndex]);
  }

  const plain = await org.get(`/api/competitions/${id}/results`);
  assert.equal(plain.body.rows[0].score, 15, 'average of 5, 15 and 25');

  await org.patch(`/api/competitions/${id}`, { dropHighLow: true });
  const dropped = await org.get(`/api/competitions/${id}/results`);
  assert.equal(dropped.body.rows[0].score, 15, 'the middle judge remains');
  assert.equal(dropped.body.rows[0].droppedLow, 5);
  assert.equal(dropped.body.rows[0].droppedHigh, 25);
  assert.equal(dropped.body.rows[0].judgeScores.length, 3, 'every judge score is still stored for the export');
});

test('lowering a criterion maximum clamps scores already above it', async () => {
  const org = await signUpOrganizer(harness, { name: 'clamp' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const id = data.competition.id;
  const criterion = data.criteria[1]; // Whiteness, max 15

  await scoreAll(harness, data.judges[0].token, (_e, index) => (index === 1 ? 15 : 10));
  await org.patch(`/api/competitions/${id}/criteria/${criterion.id}`, { maxScore: 5 });

  const results = await org.get(`/api/competitions/${id}/results`);
  assert.equal(results.body.rows[0].judgeScores[0].values[criterion.id], 5);
  assert.equal(results.body.rows[0].score, 15, '10 on Blackness plus the clamped 5');
});

test('track assignment narrows what a sponsor judge sees and is enforced on write', async () => {
  const org = await signUpOrganizer(harness, { name: 'tracks' });
  const created = await org.post('/api/competitions', { name: 'Tracked', template: 'blank' });
  const id = created.body.competition.id;
  await org.post(`/api/competitions/${id}/criteria`, { name: 'Overall', maxScore: 10, weight: 100 });
  await org.post(`/api/competitions/${id}/entries/bulk`, {
    text: 'AI One | | Best AI\nFin One | | Best Fintech\nOpen One',
  });
  let detail = await org.get(`/api/competitions/${id}`);
  const aiTrack = detail.body.tracks.find((t) => t.name === 'Best AI');

  await org.post(`/api/competitions/${id}/judges`, { name: 'Sponsor', trackIds: [aiTrack.id] });
  await org.patch(`/api/competitions/${id}`, { status: 'live' });
  detail = await org.get(`/api/competitions/${id}`);
  const sponsor = detail.body.judges[0];

  const client = harness.client('sponsor');
  const view = await client.get(`/api/judge/${sponsor.token}`);
  assert.deepEqual(
    view.body.entries.map((e) => e.name).sort(),
    ['AI One', 'Open One'],
    'a sponsor judge sees their track plus the untracked entries',
  );

  const finEntry = detail.body.entries.find((e) => e.name === 'Fin One');
  const blocked = await client.patch(`/api/judge/${sponsor.token}/entries/${finEntry.id}`, {
    scores: { [detail.body.criteria[0].id]: 5 },
  });
  assert.equal(blocked.status, 403, 'and cannot score outside it even with the entry id');
});

test('closing a competition makes every scorecard read-only', async () => {
  const org = await signUpOrganizer(harness, { name: 'closed' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;
  const client = harness.client('closed-judge');
  const entry = (await client.get(`/api/judge/${token}`)).body.entries[0];

  await org.patch(`/api/competitions/${data.competition.id}`, { status: 'closed' });

  const view = await client.get(`/api/judge/${token}`);
  assert.equal(view.body.writable, false);
  const write = await client.patch(`/api/judge/${token}/entries/${entry.id}`, {
    scores: { [entry.criterionIds[0]]: 5 },
  });
  assert.equal(write.status, 403);
});

test('rotating a judge link invalidates the old one', async () => {
  const org = await signUpOrganizer(harness, { name: 'rotate' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const judge = data.judges[0];

  const rotated = await org.post(`/api/competitions/${data.competition.id}/judges/${judge.id}/rotate-link`);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.token, judge.token);

  assert.equal((await harness.client('anon').get(`/api/judge/${judge.token}`)).status, 404);
  assert.equal((await harness.client('anon').get(`/api/judge/${rotated.body.token}`)).status, 200);
});

test('one organizer cannot read or write another organizer competition', async () => {
  const owner = await signUpOrganizer(harness, { name: 'owner' });
  const stranger = await signUpOrganizer(harness, { name: 'stranger' });
  const data = await createFullCompetition(owner, { entries: 1, judges: 1 });
  const id = data.competition.id;

  for (const attempt of [
    () => stranger.get(`/api/competitions/${id}`),
    () => stranger.patch(`/api/competitions/${id}`, { name: 'Hijacked' }),
    () => stranger.del(`/api/competitions/${id}`),
    () => stranger.post(`/api/competitions/${id}/entries`, { name: 'Injected' }),
    () => stranger.get(`/api/competitions/${id}/results`),
    () => stranger.get(`/api/competitions/${id}/export/leaderboard.csv`),
  ]) {
    const res = await attempt();
    assert.equal(res.status, 404, 'ownership failures look like a missing resource');
  }

  const anon = harness.client('anon-authz');
  assert.equal((await anon.get(`/api/competitions/${id}`)).status, 401);
  assert.equal((await anon.get('/api/competitions')).status, 401);
});

test('a judge cannot reach another competition entry through their own link', async () => {
  const orgA = await signUpOrganizer(harness, { name: 'crossA' });
  const orgB = await signUpOrganizer(harness, { name: 'crossB' });
  const a = await createFullCompetition(orgA, { entries: 1, judges: 1 });
  const b = await createFullCompetition(orgB, { entries: 1, judges: 1 });

  const res = await harness
    .client('cross-judge')
    .patch(`/api/judge/${a.judges[0].token}/entries/${b.entries[0].id}`, {
      scores: { [b.criteria[0].id]: 5 },
    });
  assert.equal(res.status, 404);
});

test('the public board can be switched off and score display can be hidden', async () => {
  const org = await signUpOrganizer(harness, { name: 'visibility' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const slug = data.competition.slug;
  await scoreAll(harness, data.judges[0].token, () => 5);

  const withScores = await harness.client('anon').get(`/api/board/${slug}`);
  assert.equal(withScores.body.rows[0].score, 10);

  await org.patch(`/api/competitions/${data.competition.id}`, { showScoresOnBoard: false });
  const hidden = await harness.client('anon').get(`/api/board/${slug}`);
  assert.equal(hidden.body.rows[0].score, null, 'ranking is published without the numbers');
  assert.equal(hidden.body.rows[0].scored, true);
  assert.equal(hidden.body.rows[0].rank, 1);

  await org.patch(`/api/competitions/${data.competition.id}`, { publicBoard: false });
  const off = await harness.client('anon').get(`/api/board/${slug}`);
  assert.equal(off.status, 403);
});

test('regenerating the public slug retires the old URL', async () => {
  const org = await signUpOrganizer(harness, { name: 'slug' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const oldSlug = data.competition.slug;

  const res = await org.post(`/api/competitions/${data.competition.id}/regenerate-slug`);
  assert.equal(res.status, 200);
  assert.notEqual(res.body.slug, oldSlug);
  assert.equal((await harness.client('anon').get(`/api/board/${oldSlug}`)).status, 404);
  assert.equal((await harness.client('anon').get(`/api/board/${res.body.slug}`)).status, 200);
});

test('exports carry the per-judge breakdown and the feedback notes', async () => {
  const org = await signUpOrganizer(harness, { name: 'export' });
  const data = await createFullCompetition(org, { entries: 2, judges: 2 });
  const id = data.competition.id;

  const judgeClient = await scoreAll(harness, data.judges[0].token, () => 4);
  await judgeClient.patch(`/api/judge/${data.judges[0].token}/entries/${data.entries[0].id}`, {
    notes: 'Solid, but the demo crashed once.',
  });

  const leaderboard = await org.get(`/api/competitions/${id}/export/leaderboard.csv`);
  assert.equal(leaderboard.status, 200);
  assert.match(leaderboard.headers.get('content-type'), /text\/csv/);
  assert.match(leaderboard.headers.get('content-disposition'), /attachment; filename=/);
  assert.match(leaderboard.body, /Rank,Entry,Team,Track,Score/);
  assert.match(leaderboard.body, /Blackness \(avg \/10\)/);

  const perJudge = await org.get(`/api/competitions/${id}/export/per-judge.csv`);
  assert.match(perJudge.body, /Judge 1/);
  assert.match(perJudge.body, /Solid, but the demo crashed once\./);

  const notes = await org.get(`/api/competitions/${id}/export/notes.csv`);
  assert.match(notes.body, /Solid, but the demo crashed once\./);
  assert.ok(!notes.body.includes('Project B'), 'entries with no feedback are not padded into the file');

  const full = await org.get(`/api/competitions/${id}/export/full.json`);
  assert.equal(full.body.competition.id, id);
  assert.equal(full.body.leaderboard.length, 2);
  assert.equal(full.body.judges.length, 2);
});

test('clearing scores keeps the roster and reopens the judges', async () => {
  const org = await signUpOrganizer(harness, { name: 'reset' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const id = data.competition.id;

  const judgeClient = await scoreAll(harness, data.judges[0].token, () => 3);
  await judgeClient.post(`/api/judge/${data.judges[0].token}/complete`);

  await org.post(`/api/competitions/${id}/reset-scores`);
  const detail = await org.get(`/api/competitions/${id}`);
  assert.equal(detail.body.entries.length, 1);
  assert.equal(detail.body.judges.length, 1);
  assert.equal(detail.body.judges[0].completedAt, null);
  assert.equal(detail.body.results.rows[0].score, null);
  assert.equal(detail.body.results.stats.filledCells, 0);
});

test('deleting a competition cascades to its scores', async () => {
  const org = await signUpOrganizer(harness, { name: 'cascade' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;
  await scoreAll(harness, token, () => 3);

  assert.equal((await org.del(`/api/competitions/${data.competition.id}`)).status, 200);
  assert.equal((await org.get(`/api/competitions/${data.competition.id}`)).status, 404);
  assert.equal((await harness.client('anon').get(`/api/judge/${token}`)).status, 404, 'the judge link dies with it');
});

test('the live stream opens and immediately pushes the current board', async () => {
  const org = await signUpOrganizer(harness, { name: 'sse' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  await scoreAll(harness, data.judges[0].token, () => 7);

  const controller = new AbortController();
  const res = await fetch(`${harness.base}/api/board/${data.competition.slug}/live`, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(res.headers.get('x-accel-buffering'), 'no', 'proxies must not buffer the stream');

  const chunk = new TextDecoder().decode((await res.body.getReader().read()).value);
  assert.match(chunk, /event: board/);
  const json = JSON.parse(chunk.slice(chunk.indexOf('data: ') + 6).split('\n')[0]);
  assert.equal(json.rows[0].score, 14);
  controller.abort();
});

test('the board sends a 304 when nothing has changed', async () => {
  const org = await signUpOrganizer(harness, { name: 'etag' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const anon = harness.client('anon-etag');

  const first = await anon.get(`/api/board/${data.competition.slug}`);
  const etag = first.headers.get('etag');
  assert.ok(etag);

  const second = await anon.raw(`/api/board/${data.competition.slug}`, { headers: { 'if-none-match': etag } });
  assert.equal(second.status, 304);
});

test('an unknown API route returns a JSON 404, not the SPA shell', async () => {
  const res = await harness.client('anon').get('/api/not-a-thing');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'not_found');
});

test('page routes serve their shells and set a strict script policy', async () => {
  for (const [path, marker] of [
    ['/', 'js/index.js'],
    ['/login', 'js/index.js'],
    ['/admin', 'js/admin.js'],
    ['/admin/c/c_whatever/results', 'js/admin.js'],
    ['/j/some-token', 'js/judge.js'],
    ['/board/some-slug', 'js/board.js'],
  ]) {
    const res = await harness.client('anon').raw(path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.ok(html.includes(marker), `${path} should load ${marker}`);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }

  const missing = await harness.client('anon').raw('/nope');
  assert.equal(missing.status, 404);
});

test('every shipped locale is served and has the same keys as English', async () => {
  const anon = harness.client('anon-i18n');
  const meta = await anon.get('/api/meta');
  assert.deepEqual(meta.body.locales, ['en', 'ja', 'es', 'zh', 'ko']);

  const english = (await anon.get('/i18n/en.json')).body;
  const keys = Object.keys(english).sort();
  assert.ok(keys.length > 100);

  for (const locale of meta.body.locales) {
    const res = await anon.get(`/i18n/${locale}.json`);
    assert.equal(res.status, 200, locale);
    assert.deepEqual(Object.keys(res.body).sort(), keys, `${locale} must define exactly the English keys`);
    for (const [key, value] of Object.entries(res.body)) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
    }
  }
});

test('placeholders match across locales so no interpolation silently breaks', async () => {
  const anon = harness.client('anon-placeholders');
  const english = (await anon.get('/i18n/en.json')).body;
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const locale of ['ja', 'es', 'zh', 'ko']) {
    const translated = (await anon.get(`/i18n/${locale}.json`)).body;
    for (const [key, value] of Object.entries(english)) {
      assert.deepEqual(
        placeholders(translated[key]),
        placeholders(value),
        `${locale}.${key} placeholders differ from English`,
      );
    }
  }
});

test('a judge language choice is remembered on their link', async () => {
  const org = await signUpOrganizer(harness, { name: 'locale' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;
  const client = harness.client('locale-judge');

  assert.equal((await client.get(`/api/judge/${token}`)).body.judge.locale, null);
  assert.equal((await client.post(`/api/judge/${token}/locale`, { locale: 'ja' })).status, 200);
  assert.equal((await client.get(`/api/judge/${token}`)).body.judge.locale, 'ja');
  assert.equal((await client.post(`/api/judge/${token}/locale`, { locale: 'klingon' })).status, 400);
});

test('an oversized notes field is rejected at the documented limit', async () => {
  const org = await signUpOrganizer(harness, { name: 'notes' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;
  const client = harness.client('notes-judge');
  const entry = (await client.get(`/api/judge/${token}`)).body.entries[0];

  const ok = await client.patch(`/api/judge/${token}/entries/${entry.id}`, { notes: 'x'.repeat(2000) });
  assert.equal(ok.status, 200);

  const tooLong = await client.patch(`/api/judge/${token}/entries/${entry.id}`, { notes: 'x'.repeat(2001) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error.code, 'too_long');
});

test('weighted mode reports scores out of 100', async () => {
  const org = await signUpOrganizer(harness, { name: 'weighted' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const id = data.competition.id;
  await org.patch(`/api/competitions/${id}`, { scoringMode: 'weighted' });

  // Full marks on the 40% criterion, half marks on the 60% one.
  await scoreAll(harness, data.judges[0].token, (_e, index, criterion) =>
    index === 0 ? criterion.maxScore : criterion.maxScore / 2,
  );

  const results = await org.get(`/api/competitions/${id}/results`);
  assert.equal(results.body.rows[0].maxScore, 100);
  assert.equal(results.body.rows[0].score, 70);
});
