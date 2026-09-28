#!/usr/bin/env node
/**
 * Grants or revokes the platform-administrator role from the command line:
 *
 *   npm run promote -- someone@example.com
 *   npm run promote -- someone@example.com --revoke
 *   npm run promote -- --list
 *
 * This is the escape hatch for the chicken-and-egg problem: a fresh deployment
 * has no superadmin, and nobody who could grant the role through the UI.
 */
import { closeDb, getDb } from '../src/db/index.js';
import { countSuperadmins } from '../src/services/platform.js';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const list = args.includes('--list');
const address = args.find((arg) => !arg.startsWith('--'))?.trim().toLowerCase();

const db = getDb();

function printAdmins() {
  const rows = db
    .prepare(`SELECT email, name, status, last_login_at FROM users WHERE role = 'superadmin' ORDER BY email`)
    .all();
  if (rows.length === 0) {
    console.log('No platform administrators yet.');
    return;
  }
  console.log(`Platform administrators (${rows.length}):`);
  for (const row of rows) {
    const seen = row.last_login_at ? `last signed in ${row.last_login_at}` : 'never signed in';
    console.log(`  ${row.email.padEnd(34)} ${row.status.padEnd(10)} ${row.name} - ${seen}`);
  }
}

try {
  if (list || !address) {
    printAdmins();
    if (!list) {
      console.log('\nUsage: npm run promote -- <e-mail> [--revoke]');
      console.log('       npm run promote -- --list');
      process.exitCode = address ? 0 : 1;
    }
  } else {
    const user = db.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(address);
    if (!user) {
      console.error(`No account with the e-mail ${address}.`);
      console.error('The account has to sign up first; this command only changes an existing one.');
      process.exitCode = 1;
    } else if (revoke) {
      if (user.role !== 'superadmin') {
        console.log(`${user.email} is not a platform administrator; nothing to do.`);
      } else if (countSuperadmins(db, { activeOnly: true }) <= 1) {
        // Same guard the API enforces: never leave the platform unadministrable.
        console.error(`${user.email} is the only active platform administrator, so the role cannot be revoked.`);
        console.error('Promote another account first.');
        process.exitCode = 1;
      } else {
        db.prepare(`UPDATE users SET role = 'organizer' WHERE id = ?`).run(user.id);
        console.log(`${user.email} is now an organizer.`);
      }
    } else if (user.role === 'superadmin') {
      console.log(`${user.email} is already a platform administrator.`);
    } else {
      db.prepare(`UPDATE users SET role = 'superadmin', status = 'active' WHERE id = ?`).run(user.id);
      console.log(`${user.email} is now a platform administrator. Open /sysadmin to use it.`);
    }
  }
} finally {
  closeDb();
}
