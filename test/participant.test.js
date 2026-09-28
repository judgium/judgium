/** Participant self-submission at /api/enter/:slug.
 *
 *  The rules the organizer asked for, asserted rather than assumed: any number
 *  of entries per account, no duplicate detection, no approval, and one flag
 *  that is the deadline for adding, editing and withdrawing alike.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { signUpOrganizer, startTestServer } from './helpers.js';

const harness = await startTestServer();
test.after(() => harness.close());

/** An organizer with one competition, submissions open unless told otherwise. */
async function openCompetition(name, { open = true } = {}) {
  const org = await signUpOrganizer(harness, { name, email: `${name}@example.com` });
  const created = await org.post('/api/competitions', { name: `${name} hackathon` });
  const id = created.body.competition.id;
  if (open) await org.patch(`/api/competitions/${id}`, { submissionsOpen: true });
  const detail = await org.get(`/api/competitions/${id}`);
  return { org, id, slug: detail.body.competition.slug };
}

async function participant(name, slug, email = `${name}@example.com`) {
  const client = harness.client(`participant-${name}-${slug}`);
  const res = await client.post(`/api/enter/${slug}/signup`, {
    name,
    email,
    password: 'password-1234',
  });
  return { client, res };
}

test('submissions are closed until the organizer opens them', async () => {
  const { slug } = await openCompetition('shut', { open: false });

  const anon = harness.client('shut-anon');
  const view = await anon.get(`/api/enter/${slug}`);
  // The page still renders - a participant with the link should be told the
  // window is shut rather than shown a dead end.
  assert.equal(view.status, 200);
  assert.equal(view.body.competition.submissionsOpen, false);

  // Account creation is gated on the window, so a competition that never opened
  // cannot have participant accounts created against it.
  const blocked = await anon.post(`/api/enter/${slug}/signup`, {
    name: 'Nope',
    email: 'nope@example.com',
    password: 'password-1234',
  });
  assert.equal(blocked.status, 403);
});

test('one account may submit any number of entries, duplicates included', async () => {
  const { slug, org, id } = await openCompetition('many');
  const { client, res } = await participant('alice', slug);
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'participant');

  for (let n = 0; n < 3; n++) {
    const created = await client.post(`/api/enter/${slug}/entries`, {
      name: 'Identical name',
      teamName: 'Team A',
      projectUrl: 'https://github.com/a/p',
      videoUrl: 'https://video.example/a',
      description: 'Recorded demo, judge asynchronously.',
    });
    assert.equal(created.status, 201, `submission ${n + 1} should be accepted`);
  }

  const mine = await client.get(`/api/enter/${slug}`);
  assert.equal(mine.body.entries.length, 3);

  // The organizer sees all three, attributed by name.
  const detail = await org.get(`/api/competitions/${id}`);
  const submitted = detail.body.entries.filter((e) => e.submittedBy === 'alice');
  assert.equal(submitted.length, 3);
});

test('an organizer-created entry has no submitter', async () => {
  const { org, id } = await openCompetition('mixed');
  await org.post(`/api/competitions/${id}/entries`, { name: 'Added by hand' });
  const detail = await org.get(`/api/competitions/${id}`);
  const entry = detail.body.entries.find((e) => e.name === 'Added by hand');
  assert.equal(entry.submittedBy, null);
});

test('a participant sees and touches only their own entries', async () => {
  const { slug } = await openCompetition('isolate');
  const alice = (await participant('alice2', slug)).client;
  const bob = (await participant('bob2', slug)).client;

  const created = await alice.post(`/api/enter/${slug}/entries`, { name: "Alice's work" });
  const entryId = created.body.entry.id;

  const bobsView = await bob.get(`/api/enter/${slug}`);
  assert.deepEqual(bobsView.body.entries, [], "Bob must not see Alice's submissions");

  // 404, not 403: another participant's entry id should read as nonexistent.
  assert.equal((await bob.patch(`/api/enter/${slug}/entries/${entryId}`, { name: 'hijacked' })).status, 404);
  assert.equal((await bob.del(`/api/enter/${slug}/entries/${entryId}`)).status, 404);

  const stillMine = await alice.get(`/api/enter/${slug}`);
  assert.equal(stillMine.body.entries[0].name, "Alice's work");
});

test('closing submissions blocks adding, editing and withdrawing alike', async () => {
  const { org, id, slug } = await openCompetition('deadline');
  const { client } = await participant('carol', slug);
  const created = await client.post(`/api/enter/${slug}/entries`, { name: 'In time' });
  const entryId = created.body.entry.id;

  await org.patch(`/api/competitions/${id}`, { submissionsOpen: false });

  assert.equal((await client.post(`/api/enter/${slug}/entries`, { name: 'Too late' })).status, 403);
  assert.equal((await client.patch(`/api/enter/${slug}/entries/${entryId}`, { name: 'Edited late' })).status, 403);
  assert.equal((await client.del(`/api/enter/${slug}/entries/${entryId}`)).status, 403);

  // Read access survives the deadline: a participant can still see what they
  // entered, they just cannot change it.
  const after = await client.get(`/api/enter/${slug}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.entries.length, 1);
  assert.equal(after.body.entries[0].name, 'In time');
  assert.equal(after.body.competition.submissionsOpen, false);
});

test('withdrawing removes the entry while the window is open', async () => {
  const { slug } = await openCompetition('withdraw');
  const { client } = await participant('dave', slug);
  const created = await client.post(`/api/enter/${slug}/entries`, { name: 'Second thoughts' });

  assert.equal((await client.del(`/api/enter/${slug}/entries/${created.body.entry.id}`)).status, 204);
  assert.deepEqual((await client.get(`/api/enter/${slug}`)).body.entries, []);
});

test('a participant account cannot reach anything an organizer owns', async () => {
  const { slug, id } = await openCompetition('walled');
  const { client } = await participant('erin', slug);

  // Without this the account could run a competition of its own, having signed
  // up through somebody else's submission link.
  assert.equal((await client.get('/api/competitions')).status, 403);
  assert.equal((await client.post('/api/competitions', { name: 'Mine now' })).status, 403);
  assert.equal((await client.get(`/api/competitions/${id}`)).status, 403);
  assert.equal((await client.post(`/api/competitions/${id}/entries`, { name: 'x' })).status, 403);
  assert.equal((await client.get(`/api/competitions/${id}/export/leaderboard.csv`)).status, 403);
  assert.equal((await client.get('/api/sysadmin/overview')).status, 403);
});

test('a judge receives the repository and video a participant submitted', async () => {
  const { org, id, slug } = await openCompetition('async');
  const { client } = await participant('frank', slug);
  await client.post(`/api/enter/${slug}/entries`, {
    name: 'Async entry',
    projectUrl: 'https://github.com/frank/project',
    videoUrl: 'https://video.example/frank',
    description: 'Three-minute recorded demo.',
  });

  await org.post(`/api/competitions/${id}/criteria`, { name: 'Quality', maxScore: 10 });
  const judge = await org.post(`/api/competitions/${id}/judges`, { name: 'Judge A' });

  const view = await harness.client('async-judge').get(`/api/judge/${judge.body.judge.token}`);
  const entry = view.body.entries.find((e) => e.name === 'Async entry');
  assert.equal(entry.projectUrl, 'https://github.com/frank/project');
  assert.equal(entry.videoUrl, 'https://video.example/frank');
  assert.equal(entry.description, 'Three-minute recorded demo.');
});

test('a participant cannot invent a track or seat themselves at a table', async () => {
  const { org, id, slug } = await openCompetition('tracks');
  const track = await org.post(`/api/competitions/${id}/tracks`, { name: 'Best AI' });
  const { client } = await participant('grace', slug);

  const bad = await client.post(`/api/enter/${slug}/entries`, { name: 'x', trackId: 'tr_nonexistent' });
  assert.equal(bad.status, 400);

  // tableLabel is where an organizer seats a team in the demo room, so a
  // submitter setting it is ignored rather than honoured.
  const ok = await client.post(`/api/enter/${slug}/entries`, {
    name: 'On a real track',
    trackId: track.body.track.id,
    tableLabel: 'T99',
  });
  assert.equal(ok.status, 201);

  const detail = await org.get(`/api/competitions/${id}`);
  const entry = detail.body.entries.find((e) => e.name === 'On a real track');
  assert.equal(entry.trackId, track.body.track.id);
  assert.equal(entry.tableLabel, '');
});

test('the submission link is rejected when no competition has that slug', async () => {
  const res = await harness.client('slug-miss').get('/api/enter/no-such-competition');
  assert.equal(res.status, 404);
});
