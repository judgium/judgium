/** The platform-administration API: who may reach it, what it can see across
 *  tenants, and the lockout cases it must refuse. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFullCompetition, signUpOrganizer, signUpSuperadmin, startTestServer } from './helpers.js';
import { migrations } from '../src/db/migrations.js';

const harness = await startTestServer();
test.after(() => harness.close());

const root = await signUpSuperadmin(harness, { name: 'root', email: 'root@example.com' });

test('an organizer cannot reach any part of the platform API', async () => {
  const organizer = await signUpOrganizer(harness, { name: 'plain', email: 'plain@example.com' });

  for (const [method, path] of [
    ['get', '/api/sysadmin/overview'],
    ['get', '/api/sysadmin/users'],
    ['get', '/api/sysadmin/competitions'],
    ['get', '/api/sysadmin/audit'],
    ['post', '/api/sysadmin/backup'],
  ]) {
    const res = await organizer[method](path);
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path} must be refused`);
    assert.equal(res.body.error.code, 'forbidden');
  }
});

test('a signed-out visitor gets 401, not 403, so the client knows to sign in', async () => {
  const res = await harness.client('sys-anon').get('/api/sysadmin/overview');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'unauthorized');
});

test('/api/auth/me reports the role, which is what gates the UI', async () => {
  const mine = await root.get('/api/auth/me');
  assert.equal(mine.body.user.role, 'superadmin');

  const organizer = await signUpOrganizer(harness, { name: 'role-check', email: 'role-check@example.com' });
  assert.equal((await organizer.get('/api/auth/me')).body.user.role, 'organizer');
});

test('the overview counts every tenant, not just the administrator', async () => {
  const other = await signUpOrganizer(harness, { name: 'counted', email: 'counted@example.com' });
  await createFullCompetition(other, { entries: 2, judges: 2 });

  const res = await root.get('/api/sysadmin/overview');
  assert.equal(res.status, 200);
  assert.ok(res.body.users.total >= 2);
  assert.ok(res.body.competitions.total >= 1);
  assert.ok(res.body.content.entries >= 2);
  assert.equal(res.body.users.superadmins, 1);
  // The storage block is what an operator checks for durability.
  assert.ok(res.body.storage.dbPath.endsWith('.db'));
  assert.equal(res.body.storage.sessionsSurviveRestart, true);
  // Compared against the last migration rather than a literal, so adding one
  // does not break this test - what matters is that the reported version is
  // the newest applied, not which id that happens to be today.
  assert.equal(res.body.storage.schemaVersion, migrations.at(-1).id);
});

test('accounts can be searched and filtered across the whole deployment', async () => {
  await signUpOrganizer(harness, { name: 'findme', email: 'needle@example.com' });

  const hit = await root.get('/api/sysadmin/users?q=needle');
  assert.equal(hit.status, 200);
  assert.equal(hit.body.users.length, 1);
  assert.equal(hit.body.users[0].email, 'needle@example.com');
  assert.equal(hit.body.users[0].role, 'organizer');

  const admins = await root.get('/api/sysadmin/users?role=superadmin');
  assert.equal(admins.body.users.length, 1);
  assert.equal(admins.body.users[0].email, 'root@example.com');

  const miss = await root.get('/api/sysadmin/users?q=nobody-by-that-name');
  assert.deepEqual(miss.body.users, []);
});

test('competitions from every owner are listed with their owner attached', async () => {
  const owner = await signUpOrganizer(harness, { name: 'listed', email: 'listed@example.com' });
  const detail = await createFullCompetition(owner, { entries: 2, judges: 1 });

  const res = await root.get(`/api/sysadmin/competitions?q=${encodeURIComponent('Test Hackathon')}`);
  assert.equal(res.status, 200);
  const found = res.body.competitions.find((c) => c.id === detail.competition.id);
  assert.ok(found, 'the competition appears even though root does not own it');
  assert.equal(found.ownerEmail, 'listed@example.com');
  assert.equal(found.counts.entries, 2);
});

test('suspending an account blocks sign-in and existing sessions alike', async () => {
  const victim = await signUpOrganizer(harness, { name: 'victim', email: 'victim@example.com' });
  const id = (await victim.get('/api/auth/me')).body.user.id;

  // The live session still works right up to the suspension.
  assert.equal((await victim.get('/api/competitions')).status, 200);

  const patched = await root.patch(`/api/sysadmin/users/${id}`, { status: 'suspended' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.user.status, 'suspended');

  // Already-issued cookie: rejected on the next request, not left to expire.
  const afterSuspend = await victim.get('/api/competitions');
  assert.equal(afterSuspend.status, 403);
  assert.equal(afterSuspend.body.error.code, 'account_suspended');

  // A fresh sign-in with the right password is refused too.
  const login = await harness.client('victim-relogin').post('/api/auth/login', {
    email: 'victim@example.com',
    password: 'a-long-password',
  });
  assert.equal(login.status, 403);
  assert.equal(login.body.error.code, 'account_suspended');

  // And reinstating restores both.
  await root.patch(`/api/sysadmin/users/${id}`, { status: 'active' });
  assert.equal((await victim.get('/api/competitions')).status, 200);
});

test('a suspended account keeps its data; /me explains why it looks signed out', async () => {
  const owner = await signUpOrganizer(harness, { name: 'keeper', email: 'keeper@example.com' });
  const detail = await createFullCompetition(owner, { entries: 2, judges: 1 });
  const id = (await owner.get('/api/auth/me')).body.user.id;

  await root.patch(`/api/sysadmin/users/${id}`, { status: 'suspended' });

  const me = await owner.get('/api/auth/me');
  assert.equal(me.body.user, null);
  assert.equal(me.body.suspended, true, 'the client can tell suspension from a plain sign-out');

  await root.patch(`/api/sysadmin/users/${id}`, { status: 'active' });
  const back = await owner.get(`/api/competitions/${detail.competition.id}`);
  assert.equal(back.status, 200, 'nothing was lost while suspended');
  assert.equal(back.body.entries.length, 2);
});

test('promotion and demotion move an account in and out of the platform role', async () => {
  const candidate = await signUpOrganizer(harness, { name: 'promo', email: 'promo@example.com' });
  const id = (await candidate.get('/api/auth/me')).body.user.id;

  assert.equal((await candidate.get('/api/sysadmin/overview')).status, 403);

  const up = await root.patch(`/api/sysadmin/users/${id}`, { role: 'superadmin' });
  assert.equal(up.body.user.role, 'superadmin');
  assert.equal((await candidate.get('/api/sysadmin/overview')).status, 200, 'the role takes effect immediately');

  const down = await root.patch(`/api/sysadmin/users/${id}`, { role: 'organizer' });
  assert.equal(down.body.user.role, 'organizer');
  assert.equal((await candidate.get('/api/sysadmin/overview')).status, 403);
});

test('an administrator cannot demote, suspend or delete themselves', async () => {
  const id = (await root.get('/api/auth/me')).body.user.id;

  for (const body of [{ role: 'organizer' }, { status: 'suspended' }]) {
    const res = await root.patch(`/api/sysadmin/users/${id}`, body);
    assert.equal(res.status, 403, `${JSON.stringify(body)} on self must be refused`);
  }
  const deleted = await root.del(`/api/sysadmin/users/${id}`);
  assert.equal(deleted.status, 403);

  // Still an administrator afterwards.
  assert.equal((await root.get('/api/auth/me')).body.user.role, 'superadmin');
});

test('the platform can never be left without an administrator', async () => {
  const second = await signUpOrganizer(harness, { name: 'second', email: 'second@example.com' });
  const secondId = (await second.get('/api/auth/me')).body.user.id;
  const rootId = (await root.get('/api/auth/me')).body.user.id;

  await root.patch(`/api/sysadmin/users/${secondId}`, { role: 'superadmin' });

  // Administrators may demote each other, so handover is possible.
  assert.equal((await second.patch(`/api/sysadmin/users/${rootId}`, { role: 'organizer' })).status, 200);
  assert.equal((await root.get('/api/sysadmin/overview')).status, 403, 'root really lost the role');

  // `second` is now the only administrator. The one remaining way to reach zero
  // would be to act on itself, and that is exactly what is refused - which is
  // why the invariant holds without needing a count.
  for (const body of [{ role: 'organizer' }, { status: 'suspended' }]) {
    assert.equal((await second.patch(`/api/sysadmin/users/${secondId}`, body)).status, 403);
  }
  assert.equal((await second.del(`/api/sysadmin/users/${secondId}`)).status, 403);
  assert.equal((await second.get('/api/sysadmin/overview')).status, 200, 'still an administrator');

  // Hand the role back so the remaining tests run as `root`.
  await second.patch(`/api/sysadmin/users/${rootId}`, { role: 'superadmin' });
  await root.patch(`/api/sysadmin/users/${secondId}`, { role: 'organizer' });
  assert.equal((await second.get('/api/sysadmin/overview')).status, 403);
});

test('deleting an account takes its competitions with it and nothing else', async () => {
  const doomed = await signUpOrganizer(harness, { name: 'doomed', email: 'doomed@example.com' });
  const bystander = await signUpOrganizer(harness, { name: 'bystander', email: 'bystander@example.com' });
  const doomedComp = await createFullCompetition(doomed, { entries: 2, judges: 1 });
  const keptComp = await createFullCompetition(bystander, { entries: 2, judges: 1 });
  const id = (await doomed.get('/api/auth/me')).body.user.id;

  const res = await root.del(`/api/sysadmin/users/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.removedCompetitions, 1);

  const gone = await root.get(`/api/sysadmin/competitions?q=${encodeURIComponent(doomedComp.competition.slug)}`);
  assert.deepEqual(gone.body.competitions, [], 'the tenant and its competition are gone');

  const stillThere = await bystander.get(`/api/competitions/${keptComp.competition.id}`);
  assert.equal(stillThere.status, 200, "another tenant's data is untouched");

  const board = await harness.client('anon-board').get(`/api/board/${doomedComp.competition.slug}`);
  assert.equal(board.status, 404, 'the deleted competition stops serving its public board');
});

test('a competition can be closed and deleted from the platform view', async () => {
  const owner = await signUpOrganizer(harness, { name: 'moderated', email: 'moderated@example.com' });
  const detail = await createFullCompetition(owner, { entries: 2, judges: 1 });
  const id = detail.competition.id;

  const closed = await root.patch(`/api/sysadmin/competitions/${id}`, { status: 'closed' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.competition.status, 'closed');
  assert.equal((await owner.get(`/api/competitions/${id}`)).body.competition.status, 'closed');

  assert.equal((await root.del(`/api/sysadmin/competitions/${id}`)).status, 200);
  assert.equal((await owner.get(`/api/competitions/${id}`)).status, 404);
});

test('an administrator can provision an account and reset its password', async () => {
  const created = await root.post('/api/sysadmin/users', {
    email: 'provisioned@example.com',
    name: 'Provisioned Organizer',
    password: 'initial-password-1',
    role: 'organizer',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.email, 'provisioned@example.com');
  const id = created.body.user.id;

  const signIn = await harness.client('prov').post('/api/auth/login', {
    email: 'provisioned@example.com',
    password: 'initial-password-1',
  });
  assert.equal(signIn.status, 200);

  assert.equal(
    (await root.post(`/api/sysadmin/users/${id}/password`, { newPassword: 'a-replacement-password' })).status,
    200,
  );

  const stale = await harness.client('prov-stale').post('/api/auth/login', {
    email: 'provisioned@example.com',
    password: 'initial-password-1',
  });
  assert.equal(stale.status, 401, 'the old password stops working');

  const fresh = await harness.client('prov-fresh').post('/api/auth/login', {
    email: 'provisioned@example.com',
    password: 'a-replacement-password',
  });
  assert.equal(fresh.status, 200);

  const weak = await root.post('/api/sysadmin/users/' + id + '/password', { newPassword: 'short' });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error.code, 'weak_password');

  const duplicate = await root.post('/api/sysadmin/users', {
    email: 'provisioned@example.com',
    name: 'Again',
    password: 'another-long-password',
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'email_taken');
});

test('every administrative write lands in the audit log, attributed and ordered', async () => {
  const subject = await signUpOrganizer(harness, { name: 'audited', email: 'audited@example.com' });
  const id = (await subject.get('/api/auth/me')).body.user.id;

  await root.patch(`/api/sysadmin/users/${id}`, { status: 'suspended' });
  await root.patch(`/api/sysadmin/users/${id}`, { status: 'active' });

  const res = await root.get('/api/sysadmin/audit?limit=20');
  assert.equal(res.status, 200);
  assert.ok(res.body.total > 0);

  const mine = res.body.events.filter((e) => e.targetId === id);
  assert.ok(mine.length >= 2, 'both changes were recorded');
  assert.equal(mine[0].actorEmail, 'root@example.com');
  assert.equal(mine[0].action, 'user.update');
  assert.match(mine[0].detail, /status/);
  // Newest first.
  assert.ok(mine[0].createdAt >= mine[1].createdAt);

  // Reads are not audited; only writes are.
  await root.get('/api/sysadmin/users');
  const after = await root.get('/api/sysadmin/audit?limit=20');
  assert.equal(after.body.total, res.body.total);
});

test('the audit trail outlives the account it refers to', async () => {
  const subject = await signUpOrganizer(harness, { name: 'ghost', email: 'ghost@example.com' });
  const id = (await subject.get('/api/auth/me')).body.user.id;
  await root.patch(`/api/sysadmin/users/${id}`, { status: 'suspended' });
  await root.del(`/api/sysadmin/users/${id}`);

  const res = await root.get('/api/sysadmin/audit?limit=50');
  const events = res.body.events.filter((e) => e.targetId === id);
  assert.ok(events.length >= 2);
  assert.ok(
    events.every((e) => e.targetLabel === 'ghost@example.com'),
    'the label is denormalised, so the row is still readable after the delete',
  );
});

test('invalid roles, statuses and paging values are rejected rather than coerced', async () => {
  const id = (await root.get('/api/auth/me')).body.user.id;

  const badRole = await root.patch(`/api/sysadmin/users/${id}`, { role: 'root' });
  assert.equal(badRole.status, 400);
  assert.equal(badRole.body.error.code, 'invalid_value');

  const badStatus = await root.patch(`/api/sysadmin/users/${id}`, { status: 'deleted' });
  assert.equal(badStatus.status, 400);

  const badLimit = await root.get('/api/sysadmin/users?limit=99999');
  assert.equal(badLimit.status, 400);
  assert.equal(badLimit.body.error.code, 'out_of_range');

  assert.equal((await root.get('/api/sysadmin/users/u_does_not_exist')).status, 404);
});

test('a backup can be taken from the platform view and is recorded', async () => {
  const res = await root.post('/api/sysadmin/backup');
  assert.equal(res.status, 201);
  assert.ok(res.body.backup.bytes > 0);
  assert.match(res.body.backup.path, /judgium-.*\.db$/);

  const log = await root.get('/api/sysadmin/audit?limit=5');
  assert.ok(log.body.events.some((e) => e.action === 'backup.create'));
});
