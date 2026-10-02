/** Snapshots taken before scoring work is destroyed.
 *
 *  Every delete in this app is a plain DELETE with no soft-delete column, and
 *  scores are the one thing in the database nobody can retype. These tests
 *  pin the two halves of that: a snapshot exists when judgement would be lost,
 *  and no snapshot is written when it would not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createFullCompetition,
  scoreAll,
  signUpOrganizer,
  signUpSuperadmin,
  startTestServer,
} from './helpers.js';

const harness = await startTestServer();
test.after(() => harness.close());

const snapshotDir = () => path.join(harness.dir, 'backups', 'pre-delete');
const snapshots = () => {
  try {
    return fs.readdirSync(snapshotDir()).filter((n) => n.endsWith('.db'));
  } catch {
    return [];
  }
};
const taken = (before, action) =>
  snapshots().filter((n) => !before.includes(n) && n.includes(action));

/** An organizer with a scored competition, plus a superadmin to read the log. */
async function scored(name) {
  const org = await signUpOrganizer(harness, { name, email: `${name}@example.com` });
  const data = await createFullCompetition(org, { entries: 2, judges: 2 });
  await scoreAll(harness, data.judges[0].token, () => 5);
  return { org, data, id: data.competition.id };
}

test('clearing every score snapshots the database first', async () => {
  const { org, id } = await scored('snapreset');
  const before = snapshots();

  assert.equal((await org.post(`/api/competitions/${id}/reset-scores`)).status, 200);

  const made = taken(before, 'reset-scores');
  assert.equal(made.length, 1, 'exactly one snapshot for one destructive call');

  // The scores are gone from the database and present in the snapshot, which is
  // the whole claim being made.
  const after = await org.get(`/api/competitions/${id}/results`);
  assert.equal(after.body.stats.filledCells, 0);
  assert.ok(fs.statSync(path.join(snapshotDir(), made[0])).size > 0);
});

test('deleting an entry nobody scored writes no snapshot', async () => {
  const org = await signUpOrganizer(harness, { name: 'snapclean', email: 'snapclean@example.com' });
  const data = await createFullCompetition(org, { entries: 2, judges: 1 });
  const before = snapshots();

  // Nothing has been scored, so there is nothing to lose and no copy to make.
  assert.equal((await org.del(`/api/competitions/${data.competition.id}/entries/${data.entries[0].id}`)).status, 200);
  assert.deepEqual(taken(before, 'entry.delete'), []);
});

test('deleting a scored entry snapshots, and deleting a judge does too', async () => {
  const { org, data, id } = await scored('snapchild');

  let before = snapshots();
  assert.equal((await org.del(`/api/competitions/${id}/entries/${data.entries[0].id}`)).status, 200);
  assert.equal(taken(before, 'entry.delete').length, 1);

  before = snapshots();
  assert.equal((await org.del(`/api/competitions/${id}/judges/${data.judges[0].id}`)).status, 200);
  assert.equal(taken(before, 'judge.delete').length, 1);
});

test('deleting the whole competition snapshots before the cascade', async () => {
  const { org, id } = await scored('snapwhole');
  const before = snapshots();

  assert.equal((await org.del(`/api/competitions/${id}`)).status, 200);
  assert.equal(taken(before, 'delete-competition').length, 1);
  // 404 rather than 403: the competition is gone, not forbidden.
  assert.equal((await org.get(`/api/competitions/${id}`)).status, 404);
});

test('an organizer destroying scores is recorded in the audit log', async () => {
  const { org, id } = await scored('snapaudit');
  await org.post(`/api/competitions/${id}/reset-scores`);

  // The audit log used to cover only platform-administrator writes, so an
  // organizer wiping a panel's work left no trace at all.
  const admin = await signUpSuperadmin(harness, { name: 'snaplog', email: 'snaplog@example.com' });
  const log = await admin.get('/api/sysadmin/audit?limit=50');
  assert.equal(log.status, 200);

  const event = log.body.events.find((e) => e.action === 'competition.reset_scores');
  assert.ok(event, 'the reset is recorded');
  assert.equal(event.targetType, 'competition');
  assert.match(event.detail, /snapshot .*\.db \(\d+ scores, \d+ notes\)/);
  assert.ok(event.actorEmail.includes('snapaudit'), 'attributed to the organizer who did it');
});

test('judgementAtRisk counts what each delete would actually take', async () => {
  const { data, id } = await scored('snaprisk');
  const { judgementAtRisk } = await import('../src/lib/safety.js');
  const { getDb } = await import('../src/db/index.js');
  const db = getDb();

  const all = judgementAtRisk(db, { competitionId: id });
  assert.ok(all.scores > 0, 'the competition has scores to lose');

  const oneJudge = judgementAtRisk(db, { competitionId: id, judgeId: data.judges[0].id });
  const silent = judgementAtRisk(db, { competitionId: id, judgeId: data.judges[1].id });
  assert.ok(oneJudge.scores > 0, 'the judge who scored has scores at risk');
  assert.equal(silent.scores, 0, 'the judge who scored nothing has none');
  assert.ok(oneJudge.scores <= all.scores);
});

test('retention keeps only the newest snapshots', async () => {
  const { pruneAutoSnapshots } = await import('../src/lib/safety.js');
  const dir = path.join(harness.dir, 'prune-test');
  fs.mkdirSync(dir, { recursive: true });

  for (let n = 1; n <= 6; n++) {
    const file = path.join(dir, `snap-${n}.db`);
    fs.writeFileSync(file, 'x');
    const when = new Date(Date.now() - (6 - n) * 60_000);
    fs.utimesSync(file, when, when);
  }

  const removed = pruneAutoSnapshots(dir, 2);
  assert.equal(removed.length, 4);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['snap-5.db', 'snap-6.db']);
});
