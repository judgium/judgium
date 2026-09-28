import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { createFullCompetition, signUpOrganizer, signUpSuperadmin, startTestServer } from './helpers.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// Captured before any test swaps globalThis.fetch for a jsdom-bound one.
const nativeFetch = globalThis.fetch;
const harness = await startTestServer();
test.after(() => harness.close());

/**
 * Loads one of the real HTML shells in jsdom, wired to the live test server,
 * and lets its real ES module boot. This exercises the pages the way a browser
 * does - module graph, fetch, i18n load, DOM construction - without a browser.
 */
async function loadPage(file, urlPath) {
  const html = fs.readFileSync(path.join(publicDir, file), 'utf8');

  // Private copy of the page's modules; see the note by the return statement.
  const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judgium-page-'));
  fs.cpSync(path.join(publicDir, 'js'), moduleDir, { recursive: true });

  const dom = new JSDOM(html, {
    url: harness.base + urlPath,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // jsdom has no fetch/EventSource; route fetch at the test server and make
  // EventSource fail immediately so the page takes its polling fallback.
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? new URL(input, harness.base).toString() : input;
    return nativeFetch(url, init);
  };
  window.EventSource = class {
    constructor() {
      this.listeners = {};
      setTimeout(() => this.listeners.error?.forEach((fn) => fn({})), 0);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    close() {}
  };

  // Only what the page modules actually touch. Notably not `performance`:
  // jsdom's own Performance implementation reads the global one and would
  // recurse forever.
  const globals = ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'Node', 'Event', 'EventSource'];
  const saved = new Map();
  const set = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

  for (const key of globals) {
    saved.set(key, globalThis[key]);
    if (key in window) set(key, window[key]);
  }
  // The page modules call fetch() bare; point the global at the test server.
  saved.set('fetch', globalThis.fetch);
  set('fetch', window.fetch);

  // The pages install long-lived timers on purpose (autosave debounce, the
  // leaderboard polling fallback). Track them so tearing a page down does not
  // leave the test runner's event loop alive.
  const timers = new Set();
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  saved.set('setTimeout', realSetTimeout);
  saved.set('setInterval', realSetInterval);
  set('setTimeout', (fn, ms, ...args) => {
    const handle = realSetTimeout(fn, ms, ...args);
    timers.add(handle);
    return handle;
  });
  set('setInterval', (fn, ms, ...args) => {
    const handle = realSetInterval(fn, ms, ...args);
    timers.add(handle);
    return handle;
  });

  // jsdom does not implement scrollTo, and the pages call it on navigation.
  window.scrollTo = () => {};

  const restore = async () => {
    for (const handle of timers) {
      clearTimeout(handle);
      clearInterval(handle);
    }
    timers.clear();
    // Let any in-flight request settle while the DOM is still valid, so a late
    // poll response cannot touch a torn-down document.
    await new Promise((resolve) => realSetTimeout(resolve, 30));
    for (const [key, value] of saved) set(key, value);
    window.close();
    fs.rmSync(moduleDir, { recursive: true, force: true });
  };

  const moduleSrc = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  const entry = moduleSrc ? path.join(moduleDir, moduleSrc.replace(/^\/js\//, '')) : null;

  return { window, document: window.document, restore, entry, moduleDir };
}

/** Waits until `predicate()` is truthy or the timeout expires. */
async function waitFor(predicate, { timeout = 4000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test('the judge page renders the scorecard, autosaves and submits', async () => {
  const org = await signUpOrganizer(harness, { name: 'fe-judge' });
  const data = await createFullCompetition(org, { entries: 3, judges: 1 });
  const token = data.judges[0].token;

  const page = await loadPage('judge.html', `/j/${token}`);
  try {
    // Cache-bust the module so each test gets a fresh module instance.
    await import(`${page.entry}?v=${Date.now()}`);

    const h1 = await waitFor(() => page.document.querySelector('#main h1'), { label: 'judge heading' });
    assert.equal(h1.textContent, 'Welcome, Judge 1');
    assert.match(page.document.querySelector('#main p').textContent, /Scoring: Test Hackathon/);
    assert.equal(page.document.title, 'Test Hackathon — Judgium');

    // Progress card, how-to notice, entry chips and criterion inputs are all up.
    assert.equal(page.document.querySelector('#progressbadge').textContent, '0 / 3 entries scored');
    assert.match(page.document.querySelector('.notice__body strong').textContent, /How to score/);

    const chips = [...page.document.querySelectorAll('#entrychips .chip')];
    assert.deepEqual(chips.map((c) => c.textContent), ['Project A', 'Project B', 'Project C']);
    assert.equal(chips[0].getAttribute('aria-selected'), 'true');

    const inputs = [...page.document.querySelectorAll('.criterion input')];
    assert.equal(inputs.length, 2);
    assert.deepEqual(
      [...page.document.querySelectorAll('.criterion__name')].map((n) => n.textContent),
      ['Blackness', 'Whiteness'],
    );
    assert.deepEqual(
      [...page.document.querySelectorAll('.criterion__max')].map((n) => n.textContent),
      ['/ 10', '/ 15'],
    );

    // Typing a score autosaves it, exactly as a judge would experience it.
    inputs[0].value = '10';
    inputs[0].dispatchEvent(new page.window.Event('input', { bubbles: true }));
    inputs[1].value = '8';
    inputs[1].dispatchEvent(new page.window.Event('blur', { bubbles: true }));

    await waitFor(() => page.document.querySelector('#progressbadge').textContent === '1 / 3 entries scored', {
      label: 'progress badge to advance after autosave',
    });
    assert.match(page.document.querySelector('#entrytotal').textContent, /18 \/ 25/);
    assert.equal(page.document.querySelector('#savestate').textContent, 'All changes saved');

    // The server really has both values.
    const stored = await harness.client('fe-check').get(`/api/judge/${token}`);
    const entryA = stored.body.entries[0];
    assert.equal(entryA.total, 18);
    assert.equal(entryA.complete, true);

    // Next moves to Project B and shows empty fields.
    const nextButton = [...page.document.querySelectorAll('#main button')].find((b) => b.textContent.includes('Next'));
    nextButton.click();
    await waitFor(() => page.document.querySelector('.entry-nav__title strong').textContent === 'Project B', {
      label: 'navigation to Project B',
    });
    assert.deepEqual([...page.document.querySelectorAll('.criterion input')].map((i) => i.value), ['', '']);
    assert.equal(page.document.querySelector('.entry-nav__title span').textContent, '2 / 3');

    // Marking complete with blanks surfaces the warning rather than submitting.
    page.document.querySelectorAll('button').forEach((b) => {
      if (b.textContent === 'Mark as complete') b.click();
    });
    const warning = await waitFor(
      () => [...page.document.querySelectorAll('.notice--warn strong')].find((n) => n.textContent.includes('not fully scored')),
      { label: 'incomplete-scorecard warning' },
    );
    assert.ok(warning);
    assert.match(page.document.querySelector('.notice--warn p').textContent, /Project B \(0\/2\), Project C \(0\/2\)/);
  } finally {
    await page.restore();
  }
});

test('the judge page renders in Japanese when the link carries that preference', async () => {
  const org = await signUpOrganizer(harness, { name: 'fe-ja' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;
  await harness.client('fe-ja-judge').post(`/api/judge/${token}/locale`, { locale: 'ja' });

  const page = await loadPage('judge.html', `/j/${token}`);
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    const h1 = await waitFor(() => page.document.querySelector('#main h1'), { label: 'judge heading' });
    assert.equal(h1.textContent, 'Judge 1 さん、こんにちは');
    assert.equal(page.document.documentElement.lang, 'ja');
    assert.equal(page.document.querySelector('#progressbadge').textContent, '採点済み 0 / 1 件');
    assert.match(page.document.querySelector('.notice__body strong').textContent, /採点方法/);

    // The language switcher lists all five locales and is set to Japanese.
    const select = page.document.querySelector('#langpick select');
    assert.deepEqual([...select.options].map((o) => o.value), ['en', 'ja', 'es', 'zh', 'ko']);
    assert.equal(select.value, 'ja');
  } finally {
    await page.restore();
  }
});

test('switching language re-renders the page and is remembered server-side', async () => {
  const org = await signUpOrganizer(harness, { name: 'fe-switch' });
  const data = await createFullCompetition(org, { entries: 1, judges: 1 });
  const token = data.judges[0].token;

  const page = await loadPage('judge.html', `/j/${token}`);
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelector('#main h1'), { label: 'judge heading' });

    const select = page.document.querySelector('#langpick select');
    select.value = 'ko';
    select.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    await waitFor(() => page.document.querySelector('#main h1').textContent.includes('환영합니다'), {
      label: 'Korean heading',
    });
    assert.equal(page.document.querySelector('#progressbadge').textContent, '채점 완료 0 / 1개');

    await waitFor(
      async () => (await harness.client('fe-switch-check').get(`/api/judge/${token}`)).body.judge.locale === 'ko',
      { label: 'locale persisted' },
    ).catch(async () => {
      const stored = await harness.client('fe-switch-check').get(`/api/judge/${token}`);
      assert.equal(stored.body.judge.locale, 'ko');
    });
  } finally {
    await page.restore();
  }
});

test('a bad judge link shows the invalid-link page instead of an error', async () => {
  const page = await loadPage('judge.html', '/j/not-a-real-token-here');
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    const h1 = await waitFor(() => page.document.querySelector('#main h1'), { label: 'invalid-link heading' });
    assert.equal(h1.textContent, 'This judging link is not valid');
  } finally {
    await page.restore();
  }
});

test('the public leaderboard ranks entries and falls back to polling without SSE', async () => {
  const org = await signUpOrganizer(harness, { name: 'fe-board' });
  const data = await createFullCompetition(org, { entries: 3, judges: 1 });
  const token = data.judges[0].token;
  const judge = harness.client('fe-board-judge');
  const view = await judge.get(`/api/judge/${token}`);

  // Project B gets 18, Project A gets 10, Project C stays unscored - the exact
  // shape of the leaderboard mock-up in the design document.
  const byName = Object.fromEntries(view.body.entries.map((e) => [e.name, e]));
  await judge.patch(`/api/judge/${token}/entries/${byName['Project B'].id}`, {
    scores: { [byName['Project B'].criterionIds[0]]: 10, [byName['Project B'].criterionIds[1]]: 8 },
  });
  await judge.patch(`/api/judge/${token}/entries/${byName['Project A'].id}`, {
    scores: { [byName['Project A'].criterionIds[0]]: 10 },
  });

  const page = await loadPage('board.html', `/board/${data.competition.slug}`);
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelectorAll('.board-row').length === 3, { label: 'three board rows' });

    const rows = [...page.document.querySelectorAll('.board-row')].map((row) => ({
      rank: row.querySelector('.board-row__rank').textContent,
      name: row.querySelector('.board-row__name').textContent,
      score: row.querySelector('.board-row__score').textContent,
      unscored: row.classList.contains('board-row--unscored'),
      width: row.querySelector('.progress__fill').style.width,
    }));

    assert.deepEqual(
      rows.map((r) => [r.rank, r.name, r.score]),
      [
        ['1', 'Project B', '18'],
        ['2', 'Project A', '10'],
        ['', 'Project C', '–'],
      ],
    );
    assert.equal(rows[0].width, '100%', 'the leader fills the bar');
    assert.equal(rows[1].width, `${(10 / 18) * 100}%`);
    assert.equal(rows[2].unscored, true);

    assert.equal(page.document.querySelector('#main h1').textContent, 'Test Hackathon');
    assert.match(page.document.querySelector('#main p').textContent, /0 of 1 judges have finished scoring/);

    // With EventSource failing, the page reports that it is polling instead.
    await waitFor(() => page.document.querySelector('#livestate').textContent.includes('Refreshing'), {
      label: 'polling fallback status',
    });
  } finally {
    await page.restore();
  }
});

test('a leaderboard with scores hidden publishes ranking without numbers', async () => {
  const org = await signUpOrganizer(harness, { name: 'fe-hidden' });
  const data = await createFullCompetition(org, { entries: 2, judges: 1 });
  const token = data.judges[0].token;
  const judge = harness.client('fe-hidden-judge');
  const view = await judge.get(`/api/judge/${token}`);
  await judge.patch(`/api/judge/${token}/entries/${view.body.entries[0].id}`, {
    scores: Object.fromEntries(view.body.entries[0].criterionIds.map((id) => [id, 5])),
  });
  await org.patch(`/api/competitions/${data.competition.id}`, { showScoresOnBoard: false });

  const page = await loadPage('board.html', `/board/${data.competition.slug}`);
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelectorAll('.board-row').length === 2, { label: 'board rows' });
    const scores = [...page.document.querySelectorAll('.board-row__score')].map((n) => n.textContent);
    assert.deepEqual(scores, ['✓', '–'], 'scored entries are marked, not numbered');
    assert.equal(page.document.querySelector('.board-row__rank').textContent, '1');
  } finally {
    await page.restore();
  }
});

test('the landing page renders the how-it-works steps and the feature grid', async () => {
  const page = await loadPage('index.html', '/');
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelector('.hero h1'), { label: 'hero' });

    assert.equal(page.document.querySelector('.hero h1').textContent, 'Judging software for hackathons');
    assert.equal(page.document.querySelectorAll('.step').length, 6, 'all six setup steps');
    assert.equal(page.document.querySelectorAll('.grid-3 .card').length, 6, 'all six features');
    assert.match(page.document.querySelector('.hero .faint').textContent, /Judges do not need an account/);

    // Anonymous visitors get sign-in and sign-up, not a dashboard link.
    const nav = [...page.document.querySelectorAll('#nav button')].map((b) => b.textContent);
    assert.deepEqual(nav, ['Sign in', 'Create account']);
  } finally {
    await page.restore();
  }
});

test('the landing page carries the service name, catchphrase and description', async () => {
  const page = await loadPage('index.html', '/?lang=ja');
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelector('.hero__tagline'), { label: 'catchphrase' });

    assert.equal(page.document.title, 'Judgium');
    assert.equal(page.document.querySelector('.topbar__brand').textContent.trim(), 'Judgium');
    assert.equal(
      page.document.querySelector('.hero__tagline').textContent,
      '挑戦を、正しく届ける、作品と評価が出会う場所。',
    );
    assert.equal(
      page.document.querySelector('.hero__lead').textContent,
      'Judgium（ジャッジアム）は、ハッカソン作品の登録から審査、集計までを一つにつなぐジャッジングプラットフォームです。',
    );
    // The footer pairs the name with the catchphrase.
    const footer = page.document.querySelector('.footer').textContent;
    assert.match(footer, /Judgium/);
    assert.match(footer, /挑戦を、正しく届ける/);

    // The catchphrase must outrank the body copy visually, not just in order.
    assert.ok(
      [...page.document.querySelectorAll('.hero p')].indexOf(page.document.querySelector('.hero__tagline')) <
        [...page.document.querySelectorAll('.hero p')].indexOf(page.document.querySelector('.hero__lead')),
      'catchphrase comes before the description',
    );
  } finally {
    await page.restore();
  }
});

test('the service name is identical in every locale, with localised copy around it', async () => {
  const anon = harness.client('anon-brand');
  const expectedTagline = {
    ja: '挑戦を、正しく届ける、作品と評価が出会う場所。',
    en: 'Every challenge conveyed fairly — where projects and judging meet.',
  };
  for (const locale of ['en', 'ja', 'es', 'zh', 'ko']) {
    const strings = (await anon.get(`/i18n/${locale}.json`)).body;
    assert.equal(strings['app.name'], 'Judgium', `${locale} must keep the name untranslated`);
    assert.match(strings['app.description'], /Judgium/, `${locale} description must name the service`);
    assert.ok(strings['app.tagline'].length > 0);
    if (expectedTagline[locale]) assert.equal(strings['app.tagline'], expectedTagline[locale]);
  }
});

test('a listener that throws does not abort a language switch', async () => {
  const page = await loadPage('index.html', '/?lang=en');
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelector('.hero h1'), { label: 'hero' });
    assert.equal(page.document.querySelector('.hero h1').textContent, 'Judging software for hackathons');

    // Pages register locale listeners that touch their own DOM. One of them
    // failing must not stop the rest of the page from re-rendering, and must
    // not leave setLocale rejected with the UI half-translated.
    const i18n = await import(`${page.moduleDir}/i18n.js`);
    let sawListener = false;
    const unsubscribe = i18n.onLocaleChange(() => {
      sawListener = true;
      throw new Error('deliberate listener failure');
    });

    try {
      await i18n.setLocale('ja');
    } finally {
      unsubscribe();
    }

    assert.equal(sawListener, true, 'the failing listener really did run');
    assert.equal(i18n.getLocale(), 'ja', 'the switch still completed');
    await waitFor(() => page.document.querySelector('.hero h1').textContent === 'ハッカソンのための審査ツール', {
      label: 'Japanese hero after the failing listener',
    });
    assert.equal(page.document.documentElement.lang, 'ja');

    // Restore English so later tests are unaffected by the shared i18n module.
    await i18n.setLocale('en');
  } finally {
    await page.restore();
  }
});

test('the sign-in form posts credentials and reports a bad password inline', async () => {
  await signUpOrganizer(harness, { name: 'fe-login', email: 'fe-login@example.com' });

  const page = await loadPage('index.html', '/login');
  try {
    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelector('#f-email'), { label: 'login form' });

    page.document.querySelector('#f-email').value = 'fe-login@example.com';
    page.document.querySelector('#f-pass').value = 'definitely-wrong';
    page.document.querySelector('#main form').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));

    const error = await waitFor(() => page.document.querySelector('.notice--danger .notice__body'), { label: 'inline error' });
    assert.match(
      error.textContent,
      /E-mail or password is incorrect/,
      'a bad password must not be reported as an expired session',
    );
  } finally {
    await page.restore();
  }
});

test('the organizer console lists competitions and opens the tabbed editor', async () => {
  const org = await signUpOrganizer(harness, { name: 'fe-admin', email: 'fe-admin@example.com' });
  const data = await createFullCompetition(org, { entries: 2, judges: 2, template: 'general' });

  const page = await loadPage('admin.html', '/admin');
  try {
    // Carry the organizer's session cookie the way the browser would.
    const cookie = (await nativeFetch(`${harness.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'fe-admin@example.com', password: 'a-long-password' }),
    }).then((res) => res.headers.getSetCookie()))[0].split(';')[0];

    const bare = page.window.fetch;
    page.window.fetch = (input, init = {}) =>
      bare(input, { ...init, headers: { ...(init.headers || {}), cookie } });
    globalThis.fetch = page.window.fetch;

    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelector('#main h1'), { label: 'dashboard' });

    assert.equal(page.document.querySelector('#main h1').textContent, 'My competitions');
    assert.match(page.document.querySelector('#whoami').textContent, /Signed in as Organizer fe-admin/);

    const card = await waitFor(() => page.document.querySelector('a.card'), { label: 'competition card' });
    assert.equal(card.querySelector('h2').textContent, 'Test Hackathon');
    assert.match(card.textContent, /2 entries/);
    assert.match(card.textContent, /2 judges/);
    assert.match(card.textContent, /6 criteria/);

    card.click();
    await waitFor(() => page.document.querySelector('.tabs'), { label: 'competition tabs' });
    assert.deepEqual(
      [...page.document.querySelectorAll('.tab')].map((t) => t.textContent),
      ['Setup', 'Rubric', 'Entries', 'Judges', 'Results'],
    );
    assert.equal(page.window.location.pathname, `/admin/c/${data.competition.id}/setup`);

    // The setup tab exposes the public board URL and the scoring switches.
    await waitFor(() => page.document.querySelector('.linkbox input'), { label: 'board url' });
    assert.match(page.document.querySelector('.linkbox input').value, new RegExp(`/board/${data.competition.slug}$`));
    const labels = [...page.document.querySelectorAll('.check__text strong')].map((n) => n.textContent);
    assert.ok(labels.includes('Drop the highest and lowest judge score'), labels.join(' | '));

    // Rubric tab shows the seeded template with its weights.
    [...page.document.querySelectorAll('.tab')].find((t) => t.textContent === 'Rubric').click();
    await waitFor(() => page.document.querySelectorAll('table.data tbody tr').length === 6, { label: 'rubric rows' });
    const maxima = [...page.document.querySelectorAll('table.data tbody tr td.num input')].map((i) => i.value);
    assert.equal(maxima.length, 12, 'a max and a weight per criterion');

    // Judges tab shows a copyable private link per judge.
    [...page.document.querySelectorAll('.tab')].find((t) => t.textContent === 'Judges').click();
    await waitFor(() => page.document.querySelectorAll('.list-item').length === 2, { label: 'judge rows' });
    const links = [...page.document.querySelectorAll('.linkbox input')].map((i) => i.value);
    assert.equal(links.length, 2);
    for (const link of links) assert.match(link, /\/j\/[a-z0-9]{24}$/);
    assert.deepEqual(
      [...page.document.querySelectorAll('.list-item .badge')].map((b) => b.textContent),
      ['Not started', 'Not started'],
    );
  } finally {
    await page.restore();
  }
});

test('the results tab shows the ranking and an expandable per-judge breakdown', async () => {
  const org = await signUpOrganizer(harness, { name: 'fe-results', email: 'fe-results@example.com' });
  const data = await createFullCompetition(org, { entries: 2, judges: 2 });
  const token = data.judges[0].token;
  const judge = harness.client('fe-results-judge');
  const view = await judge.get(`/api/judge/${token}`);
  for (const entry of view.body.entries) {
    await judge.patch(`/api/judge/${token}/entries/${entry.id}`, {
      scores: Object.fromEntries(entry.criterionIds.map((id, i) => [id, i === 0 ? 9 : 12])),
    });
  }
  await judge.patch(`/api/judge/${token}/entries/${view.body.entries[0].id}`, { notes: 'Best in show.' });

  const page = await loadPage('admin.html', `/admin/c/${data.competition.id}/results`);
  try {
    const cookie = (await nativeFetch(`${harness.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'fe-results@example.com', password: 'a-long-password' }),
    }).then((res) => res.headers.getSetCookie()))[0].split(';')[0];
    const bare = page.window.fetch;
    page.window.fetch = (input, init = {}) => bare(input, { ...init, headers: { ...(init.headers || {}), cookie } });
    globalThis.fetch = page.window.fetch;

    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelectorAll('table.data tbody tr').length >= 2, { label: 'result rows' });

    const firstRow = page.document.querySelector('table.data tbody tr');
    assert.equal(firstRow.children[0].textContent, '1');
    assert.match(firstRow.textContent, /21 \/ 25/, 'a judge total of 9 + 12');

    // Export links point at the CSV endpoints.
    const hrefs = [...page.document.querySelectorAll('a.btn')].map((a) => a.getAttribute('href'));
    for (const file of ['leaderboard.csv', 'per-judge.csv', 'notes.csv', 'full.json']) {
      assert.ok(
        hrefs.some((h) => h?.endsWith(`/export/${file}`)),
        `missing export link for ${file}`,
      );
    }

    // Expanding a row reveals that judge's criterion scores and their note.
    [...page.document.querySelectorAll('button')].find((b) => b.textContent === 'Per-judge breakdown').click();
    const inner = await waitFor(() => page.document.querySelector('td .table-scroll table.data'), { label: 'breakdown table' });
    assert.match(inner.textContent, /Judge 1/);
    assert.match(inner.textContent, /Best in show\./);
  } finally {
    await page.restore();
  }
});

test('the platform admin page boots, spans tenants and refuses ordinary organizers', async () => {
  // Two separate tenants, so the page has cross-account data to show.
  const admin = await signUpSuperadmin(harness, { name: 'fe-sys', email: 'fe-sys@example.com' });
  const tenant = await signUpOrganizer(harness, { name: 'fe-tenant', email: 'fe-tenant@example.com' });
  await createFullCompetition(tenant, { entries: 2, judges: 1 });
  const tenantId = (await tenant.get('/api/auth/me')).body.user.id;

  const signInAs = async (email) =>
    (
      await nativeFetch(`${harness.base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'a-long-password' }),
      }).then((res) => res.headers.getSetCookie())
    )[0].split(';')[0];

  const page = await loadPage('sysadmin.html', '/sysadmin');
  try {
    const cookie = await signInAs('fe-sys@example.com');
    const bare = page.window.fetch;
    page.window.fetch = (input, init = {}) =>
      bare(input, { ...init, headers: { ...(init.headers || {}), cookie } });
    globalThis.fetch = page.window.fetch;

    await import(`${page.entry}?v=${Date.now()}`);
    await waitFor(() => page.document.querySelector('#main h1'), { label: 'platform admin heading' });

    assert.equal(page.document.querySelector('#main h1').textContent, 'Platform administration');
    assert.deepEqual(
      [...page.document.querySelectorAll('.tab')].map((t) => t.textContent),
      ['Overview', 'Accounts', 'Competitions', 'Audit log'],
    );

    // Overview: the stat tiles and the durability card an operator looks for.
    const tiles = await waitFor(() => (page.document.querySelectorAll('.stat').length >= 8 ? page.document.querySelectorAll('.stat') : null), {
      label: 'stat tiles',
    });
    assert.equal(tiles.length, 8);
    const storage = [...page.document.querySelectorAll('.card')].find((c) => c.textContent.includes('Storage and durability'));
    assert.ok(storage, 'the storage card is present');
    assert.match(storage.textContent, /\.db/, 'it names the database file');
    assert.match(storage.textContent, /From SESSION_SECRET|Stored on disk/, 'and says sessions survive a restart');
    assert.ok(!storage.querySelector('.notice--warn'), 'no ephemeral-key warning when the key is configured');

    // Accounts: the other tenant is visible, which is the whole point.
    [...page.document.querySelectorAll('.tab')].find((t) => t.textContent === 'Accounts').click();
    await waitFor(() => page.document.querySelector('table.data tbody tr'), { label: 'account rows' });
    const table = page.document.querySelector('table.data');
    assert.match(table.textContent, /fe-tenant@example\.com/, "another organizer's account is listed");
    assert.match(table.textContent, /fe-sys@example\.com/);

    const ownRow = [...table.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('fe-sys@example.com'));
    assert.match(ownRow.textContent, /You/, 'the administrator sees which row is their own');
    const ownButtons = [...ownRow.querySelectorAll('button')];
    assert.ok(
      ownButtons.filter((b) => b.disabled).length >= 3,
      'the self-lockout actions are disabled on their own row',
    );

    const tenantRow = [...table.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('fe-tenant@example.com'));
    assert.match(tenantRow.textContent, /Organizer/);

    // Suspending the other tenant from the UI. Asserted purely against the
    // re-rendered table: while this page is loaded globalThis.fetch carries the
    // administrator's cookie, so a harness client would silently run as them.
    // The effect on the tenant's own session is checked after restore() below.
    [...tenantRow.querySelectorAll('button')].find((b) => b.textContent === 'Suspend').click();
    await waitFor(
      () => {
        const row = [...page.document.querySelectorAll('table.data tbody tr')].find((r) =>
          r.textContent.includes('fe-tenant@example.com'),
        );
        return row?.textContent.includes('Suspended') ? row : null;
      },
      { label: 'the account row to show the suspension' },
    );
    const suspendedRow = [...page.document.querySelectorAll('table.data tbody tr')].find((r) =>
      r.textContent.includes('fe-tenant@example.com'),
    );
    assert.ok(
      [...suspendedRow.querySelectorAll('button')].some((b) => b.textContent === 'Reinstate'),
      'the action flips to Reinstate, so it can be undone from the same row',
    );

    // Competitions: listed with their owner, across accounts.
    [...page.document.querySelectorAll('.tab')].find((t) => t.textContent === 'Competitions').click();
    await waitFor(() => page.document.querySelector('table.data tbody tr'), { label: 'competition rows' });
    assert.match(page.document.querySelector('table.data').textContent, /Test Hackathon/);
    assert.match(page.document.querySelector('table.data').textContent, /fe-tenant@example\.com/);

    // Audit log: the suspension made from this page is recorded.
    [...page.document.querySelectorAll('.tab')].find((t) => t.textContent === 'Audit log').click();
    await waitFor(() => page.document.querySelector('table.data tbody tr'), { label: 'audit rows' });
    assert.match(page.document.querySelector('table.data').textContent, /Account changed/);
    assert.match(page.document.querySelector('table.data').textContent, /fe-sys@example\.com/);
  } finally {
    await page.restore();
  }

  // globalThis.fetch is the real one again, so the tenant's own client speaks
  // for the tenant: the suspension made by clicking really locked them out.
  const lockedOut = await tenant.get('/api/competitions');
  assert.equal(lockedOut.status, 403);
  assert.equal(lockedOut.body.error.code, 'account_suspended');
  await admin.patch(`/api/sysadmin/users/${tenantId}`, { status: 'active' });
  assert.equal((await tenant.get('/api/competitions')).status, 200, 'and reinstating gives it all back');

  // An ordinary organizer who opens the same URL is sent away instead. jsdom
  // does not implement navigation and location.replace is read-only there, so
  // the assertion is the user-visible half: the page renders no platform data.
  // That /api/sysadmin itself refuses them is covered in sysadmin.test.js.
  const denied = await loadPage('sysadmin.html', '/sysadmin');
  try {
    const cookie = await signInAs('fe-tenant@example.com');
    const bare = denied.window.fetch;
    denied.window.fetch = (input, init = {}) =>
      bare(input, { ...init, headers: { ...(init.headers || {}), cookie } });
    globalThis.fetch = denied.window.fetch;

    await import(`${denied.entry}?v=${Date.now()}`);
    // Long enough that the boot sequence would have rendered had it continued.
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(denied.document.querySelector('#main h1'), null, 'no heading was rendered');
    assert.equal(denied.document.querySelector('.stat'), null, 'no platform statistics were rendered');
    assert.equal(denied.document.querySelector('table.data'), null, 'no account table was rendered');
    assert.equal(denied.document.querySelector('#boot')?.textContent, 'Loading…', 'the shell never advanced');
  } finally {
    await denied.restore();
  }
});
