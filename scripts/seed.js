#!/usr/bin/env node
/**
 * Seeds a demo hackathon so you can click through the whole flow locally:
 *
 *   npm run seed
 *
 * Prints the organizer credentials, every judge link and the public
 * leaderboard URL. Safe to re-run - it replaces the demo competition only.
 */
import { config } from '../src/config.js';
import { getDb, closeDb } from '../src/db/index.js';
import { hashPassword } from '../src/lib/auth.js';
import { newId, newJudgeToken, slugify } from '../src/lib/ids.js';
import { templateCriteria } from '../src/lib/templates.js';

const DEMO_EMAIL = 'organizer@example.com';
const DEMO_PASSWORD = 'demo-password-1234';
const COMPETITION_NAME = 'Spring Hackathon 2026';

const ENTRIES = [
  ['Aurora', 'Team Northern Lights', 'Best AI', 'T1'],
  ['BudgetBuddy', 'Fintech Four', 'Best Fintech', 'T2'],
  ['CarbonLedger', 'Team Verdant', 'Best Fintech', 'T3'],
  ['DocuMentor', 'The Rubber Ducks', 'Best AI', 'T4'],
  ['EchoNotes', 'Team Resonance', 'Best AI', 'T5'],
  ['FloodWatch', 'Civic Coders', '', 'T6'],
  ['GreenRoute', 'Team Pathfinder', '', 'T7'],
  ['HandsOn', 'Signal & Noise', 'Best AI', 'T8'],
  ['InvoiceIQ', 'Ledger Legends', 'Best Fintech', 'T9'],
  ['JoltJournal', 'Team Voltage', '', 'T10'],
  ['KiteString', 'The Loose Ends', '', 'T11'],
  ['LumenLab', 'Team Photon', 'Best AI', 'T12'],
];

const JUDGES = [
  ['Ada Lovelace', 'ada@example.com', []],
  ['Grace Hopper', 'grace@example.com', []],
  ['Alan Turing', 'alan@example.com', []],
  ['Sponsor: Contoso Cloud', 'judge@contoso.example', ['Best AI']],
  ['Sponsor: Fabrikam Pay', 'judge@fabrikam.example', ['Best Fintech']],
];

// A deterministic pseudo-random source keeps re-runs comparable.
let seed = 20260907;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const now = () => new Date().toISOString();

function seedDatabase() {
  const db = getDb();

  const run = db.transaction(() => {
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(DEMO_EMAIL);
    if (!user) {
      const id = newId('u_');
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, locale, created_at)
         VALUES (?, ?, ?, ?, 'en', ?)`,
      ).run(id, DEMO_EMAIL, 'Demo Organizer', hashPassword(DEMO_PASSWORD), now());
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    // Replace any previous demo competition so re-running stays idempotent.
    db.prepare('DELETE FROM competitions WHERE owner_id = ? AND name = ?').run(user.id, COMPETITION_NAME);

    const competitionId = newId('c_');
    const slug = slugify(COMPETITION_NAME);
    db.prepare(
      `INSERT INTO competitions (id, owner_id, name, description, public_slug, status, scoring_mode,
                                 aggregate, drop_high_low, public_board, show_scores_on_board,
                                 allow_notes, allow_decimals, rev, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'live', 'points', 'avg', 0, 1, 1, 1, 1, 0, ?, ?)`,
    ).run(
      competitionId,
      user.id,
      COMPETITION_NAME,
      'Twelve teams, five judges, four-minute demos. Seeded demo data.',
      slug,
      now(),
      now(),
    );

    // Tracks
    const trackIds = new Map();
    for (const [index, name] of ['Best AI', 'Best Fintech'].entries()) {
      const id = newId('t_');
      db.prepare('INSERT INTO tracks (id, competition_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        competitionId,
        name,
        index,
        now(),
      );
      trackIds.set(name, id);
    }

    // Rubric
    const criteria = templateCriteria('general');
    const criterionIds = [];
    for (const criterion of criteria) {
      const id = newId('k_');
      db.prepare(
        `INSERT INTO criteria (id, competition_id, track_id, name, description, max_score, weight, sort_order, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(id, competitionId, criterion.name, criterion.description, criterion.maxScore, criterion.weight, criterion.sortOrder, now());
      criterionIds.push({ id, maxScore: criterion.maxScore });
    }

    // Entries
    const entryRows = [];
    for (const [index, [name, team, track, table]] of ENTRIES.entries()) {
      const id = newId('e_');
      db.prepare(
        `INSERT INTO entries (id, competition_id, track_id, name, team_name, description, project_url,
                              video_url, table_label, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?, ?)`,
      ).run(id, competitionId, track ? trackIds.get(track) : null, name, team, table, index, now());
      entryRows.push({ id, trackId: track ? trackIds.get(track) : null });
    }

    // Judges
    const judgeRows = [];
    for (const [index, [name, email, tracks]] of JUDGES.entries()) {
      const id = newId('j_');
      const token = newJudgeToken();
      db.prepare(
        `INSERT INTO judges (id, competition_id, name, email, token, locale, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(id, competitionId, name, email, token, index, now());
      for (const trackName of tracks) {
        db.prepare('INSERT INTO judge_tracks (judge_id, track_id) VALUES (?, ?)').run(id, trackIds.get(trackName));
      }
      judgeRows.push({ id, name, token, tracks: tracks.map((t) => trackIds.get(t)) });
    }

    // Scores: the three general judges finish, the two sponsor judges are
    // mid-way through their own track, so the demo shows a live-in-progress
    // leaderboard rather than a finished one.
    const insertScore = db.prepare(
      `INSERT INTO scores (judge_id, entry_id, criterion_id, value, updated_at) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertNote = db.prepare(
      `INSERT INTO notes (judge_id, entry_id, body, updated_at) VALUES (?, ?, ?, ?)`,
    );

    for (const judge of judgeRows) {
      const visible = entryRows.filter((entry) => judge.tracks.length === 0 || !entry.trackId || judge.tracks.includes(entry.trackId));
      const isSponsor = judge.tracks.length > 0;
      const limit = isSponsor ? Math.ceil(visible.length / 2) : visible.length;

      visible.slice(0, limit).forEach((entry, position) => {
        for (const criterion of criterionIds) {
          const value = Math.min(criterion.maxScore, Math.round((4 + rand() * 6) * 2) / 2);
          insertScore.run(judge.id, entry.id, criterion.id, value, now());
        }
        if (position % 3 === 0) {
          insertNote.run(judge.id, entry.id, 'Strong demo, clear problem statement. Watch the scope creep.', now());
        }
      });

      if (!isSponsor) {
        db.prepare('UPDATE judges SET completed_at = ? WHERE id = ?').run(now(), judge.id);
      }
    }

    db.prepare('UPDATE competitions SET rev = rev + 1 WHERE id = ?').run(competitionId);
    return { slug, judgeRows };
  });

  return run();
}

const { slug, judgeRows } = seedDatabase();
const base = config.publicBaseUrl || `http://localhost:${config.port}`;

console.log('\nSeeded demo data into', config.dbPath);
console.log('\nOrganizer sign-in');
console.log('  URL       ', `${base}/login`);
console.log('  e-mail    ', DEMO_EMAIL);
console.log('  password  ', DEMO_PASSWORD);
console.log('\nPublic leaderboard');
console.log('  ', `${base}/board/${slug}`);
console.log('\nJudge links');
for (const judge of judgeRows) {
  console.log(`   ${judge.name.padEnd(26)} ${base}/j/${judge.token}`);
}
console.log('');

closeDb();
