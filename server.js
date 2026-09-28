import { createApp } from './src/app.js';
import { config } from './src/config.js';
import { closeDb, databaseBytes, getDb, schemaVersion } from './src/db/index.js';
import { hub } from './src/lib/events.js';
import { bootstrapSuperadmins, countSuperadmins } from './src/services/platform.js';

// Fail fast on programmer error rather than limping along with a broken DB.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection:', reason);
});

const db = getDb(); // open + migrate before we start accepting traffic

// Mint the platform administrators named in SUPERADMIN_EMAILS. Idempotent, and
// the only path to the role on a deployment that has nobody who could grant it.
const promoted = bootstrapSuperadmins(db);
if (promoted.length > 0) {
  console.log(`[boot] promoted to superadmin: ${promoted.join(', ')}`);
}

const app = createApp();
const server = app.listen(config.port, () => {
  const { capacity } = config;
  console.log(`Judgium listening on http://localhost:${config.port}`);
  if (config.envFile) console.log(`  env file          ${config.envFile}`);
  console.log(`  database          ${config.dbPath} (${(databaseBytes() / 1024).toFixed(0)} KB)`);
  console.log(`  schema            ${schemaVersion(db) ?? 'baseline'}`);
  console.log(
    `  detected host     ${capacity.detectedCpus} CPU / ${capacity.detectedMemoryGb} GB` +
      ` -> up to ${capacity.maxLiveClients} live viewers per instance`,
  );
  console.log(`  board refresh     coalesced to at most 1 push / ${capacity.leaderboardThrottleMs}ms`);

  // AGPL-3.0 section 13: the footer's source link has to reach the code this
  // process is actually running. An operator of a modified build who never set
  // SOURCE_URL is pointing their users at upstream instead, which is a licence
  // violation and silent from inside the app - so it is stated at boot next to
  // the other facts that are easy to get wrong.
  console.log(`  source (AGPL §13) ${config.sourceUrl}${process.env.SOURCE_URL ? '' : ' (default: upstream - set SOURCE_URL if you modified the code)'}`);

  // The session key decides whether a restart is invisible to signed-in
  // organizers or drops every one of them back on the sign-in page, so say
  // which of the three cases this process is in rather than leaving it to be
  // discovered after the next deploy.
  if (config.sessionSecretSource === 'env') {
    console.log('  sessions          signed with SESSION_SECRET; they survive restarts');
  } else if (config.sessionSecretSource === 'file') {
    console.log(`  sessions          key persisted at ${config.sessionSecretPath}; they survive restarts`);
    if (config.env === 'production') {
      console.warn('  NOTE              set SESSION_SECRET in production so the key is not on the data volume');
    }
  } else {
    console.warn('  WARNING           could not persist a session key (read-only data directory?).');
    console.warn('                    A random one is in use, so every restart signs organizers out.');
    console.warn('                    Set SESSION_SECRET to fix this.');
  }

  const superadmins = countSuperadmins(db, { activeOnly: true });
  if (superadmins === 0) {
    console.warn('  WARNING           no platform administrator exists.');
    console.warn('                    Create one with: npm run promote -- <e-mail of an existing account>');
  } else {
    console.log(`  platform admins   ${superadmins} active -> /sysadmin`);
  }
});

// SSE connections are long-lived by design; the default 5s header timeout and
// 2min keep-alive would otherwise cut idle judges and demo-room screens loose.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 0;

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} received, draining...`);

  hub.closeAll();
  server.close(() => {
    closeDb();
    console.log('[shutdown] done');
    process.exit(0);
  });

  // Azure gives a container ~30s after SIGTERM; do not outstay it.
  setTimeout(() => {
    console.warn('[shutdown] forcing exit');
    closeDb();
    process.exit(0);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
