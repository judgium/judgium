import { api, ApiError } from './api.js';
import { $, el, replace, setBusy } from './dom.js';
import { applyTranslations, initI18n, onLocaleChange, t } from './i18n.js';
import { mountLanguagePicker } from './lang.js';
import { field, openModal, select, statusLabel } from './admin/shared.js';
import { renderSetupTab } from './admin/setup.js';
import { renderRubricTab } from './admin/rubric.js';
import { renderEntriesTab } from './admin/entries.js';
import { renderJudgesTab } from './admin/judges.js';
import { renderResultsTab } from './admin/results.js';

const main = $('#main');
const TABS = ['setup', 'rubric', 'entries', 'judges', 'results'];

// Tabs register teardown work (live subscriptions, timers) here; it runs
// before the next render so nothing leaks when the organizer switches tabs.
let tabCleanups = [];
function runCleanups() {
  for (const fn of tabCleanups) {
    try {
      fn();
    } catch (err) {
      console.error('[admin] cleanup failed', err);
    }
  }
  tabCleanups = [];
}

export const store = {
  user: null,
  meta: null,
  competition: null, // full detail payload while a competition is open
};

// --- routing -----------------------------------------------------------

function parseRoute() {
  const parts = location.pathname.split('/').filter(Boolean); // ['admin', 'c', id, tab?]
  if (parts[1] === 'c' && parts[2]) {
    return { name: 'competition', id: parts[2], tab: TABS.includes(parts[3]) ? parts[3] : 'setup' };
  }
  return { name: 'dashboard' };
}

export function goto(path, { replaceEntry = false } = {}) {
  if (replaceEntry) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  void route();
}

async function route() {
  const target = parseRoute();
  if (target.name === 'dashboard') {
    store.competition = null;
    await renderDashboard();
  } else {
    await renderCompetition(target.id, target.tab);
  }
  window.scrollTo({ top: 0 });
}

// --- dashboard ---------------------------------------------------------

async function renderDashboard() {
  runCleanups();
  replace(main, el('p', { class: 'muted', text: t('state.loading') }));
  let payload;
  try {
    payload = await api.get('/api/competitions');
  } catch (err) {
    return replace(main, el('div', { class: 'card' }, el('p', { class: 'small', text: err instanceof ApiError ? err.userMessage : t('error.generic') })));
  }

  const head = el(
    'div',
    { class: 'row row--between' },
    el(
      'div',
      { class: 'stack stack--tight' },
      el('h1', { text: t('dash.title') }),
      el('p', { class: 'muted', text: t('dash.subtitle') }),
    ),
    el('button', { class: 'btn btn--primary', type: 'button', text: t('dash.new'), onclick: openCreateDialog }),
  );

  const list =
    payload.competitions.length === 0
      ? el('div', { class: 'empty', text: t('dash.empty') })
      : el(
          'div',
          { class: 'grid-2' },
          ...payload.competitions.map((competition) => competitionCard(competition)),
        );

  replace(main, el('div', { class: 'stack stack--loose' }, head, list));
  applyTranslations(main);
}

function competitionCard(competition) {
  const counts = competition.counts || {};
  return el(
    'a',
    {
      class: 'card stack stack--tight',
      href: `/admin/c/${competition.id}/setup`,
      onclick: (event) => {
        event.preventDefault();
        goto(`/admin/c/${competition.id}/setup`);
      },
    },
    el(
      'div',
      { class: 'row row--between' },
      el('h2', { class: 'break', text: competition.name }),
      el('span', { class: `badge ${competition.status === 'live' ? '' : 'badge--muted'}`, text: statusLabel(competition.status) }),
    ),
    competition.description && el('p', { class: 'small muted break', text: competition.description }),
    el(
      'div',
      { class: 'row small muted' },
      el('span', { text: t('dash.card.entries', { n: counts.entries ?? 0 }) }),
      el('span', { text: '·' }),
      el('span', { text: t('dash.card.judges', { n: counts.judges ?? 0 }) }),
      el('span', { text: '·' }),
      el('span', { text: t('dash.card.criteria', { n: counts.criteria ?? 0 }) }),
    ),
    el('p', {
      class: 'small faint',
      text: t('dash.card.judgesDone', { done: counts.judgesCompleted ?? 0, total: counts.judges ?? 0 }),
    }),
  );
}

function openCreateDialog() {
  const nameInput = el('input', { type: 'text', required: true, maxlength: '200' });
  const descInput = el('textarea', { maxlength: '4000' });
  let template = 'general';
  let scoringMode = 'points';

  nameInput.placeholder = t('dash.new.namePlaceholder');

  openModal({
    title: t('dash.new.title'),
    submitLabel: t('action.create'),
    body: el(
      'div',
      { class: 'stack' },
      field('dash.new.name', nameInput),
      field('dash.new.description', descInput),
      field(
        'dash.new.template',
        select(
          template,
          (store.meta?.templates || []).map((option) => ({
            value: option.id,
            label: `${t(option.labelKey)}${option.criterionCount ? ` (${option.criterionCount})` : ''}`,
          })),
          (value) => {
            template = value;
          },
        ),
      ),
      field(
        'dash.new.scoringMode',
        select(
          scoringMode,
          [
            { value: 'points', label: t('setup.scoringMode.points') },
            { value: 'weighted', label: t('setup.scoringMode.weighted') },
          ],
          (value) => {
            scoringMode = value;
          },
        ),
      ),
    ),
    onSubmit: async () => {
      const result = await api.post('/api/competitions', {
        name: nameInput.value,
        description: descInput.value,
        template,
        scoringMode,
      });
      goto(`/admin/c/${result.competition.id}/setup`);
    },
  });
}

// --- competition shell -------------------------------------------------

export async function reloadCompetition(tab) {
  const id = store.competition?.competition.id || parseRoute().id;
  const target = tab || parseRoute().tab;
  await renderCompetition(id, target, { keepScroll: true });
}

async function renderCompetition(id, tab, { keepScroll = false } = {}) {
  runCleanups();
  const scrollY = window.scrollY;
  if (!keepScroll) replace(main, el('p', { class: 'muted', text: t('state.loading') }));

  let data;
  try {
    data = await api.get(`/api/competitions/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return goto('/admin', { replaceEntry: true });
    return replace(main, el('div', { class: 'card' }, el('p', { class: 'small', text: err instanceof ApiError ? err.userMessage : t('error.generic') })));
  }
  store.competition = data;

  const header = el(
    'div',
    { class: 'stack stack--tight' },
    el(
      'div',
      { class: 'row row--between' },
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn btn--sm btn--ghost',
          type: 'button',
          text: `‹ ${t('nav.dashboard')}`,
          onclick: () => goto('/admin'),
        }),
      ),
      el('span', { class: `badge ${data.competition.status === 'live' ? '' : 'badge--muted'}`, text: statusLabel(data.competition.status) }),
    ),
    el('h1', { class: 'break', text: data.competition.name }),
    el('p', {
      class: 'small muted',
      text: t('results.judgesDone', {
        done: data.results.stats.judgesCompleted,
        total: data.results.stats.judgeCount,
      }),
    }),
  );

  const tabBar = el(
    'nav',
    { class: 'tabs', role: 'tablist' },
    ...TABS.map((name) =>
      el('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        'aria-selected': name === tab ? 'true' : 'false',
        text: t(`comp.tab.${name}`),
        onclick: () => goto(`/admin/c/${data.competition.id}/${name}`),
      }),
    ),
  );

  const panel = el('div', { class: 'stack stack--loose', id: 'tabpanel', role: 'tabpanel' });
  replace(main, el('div', { class: 'stack' }, header, tabBar, panel));

  const renderers = {
    setup: renderSetupTab,
    rubric: renderRubricTab,
    entries: renderEntriesTab,
    judges: renderJudgesTab,
    results: renderResultsTab,
  };
  // Tabs receive a context rather than importing back into this module, which
  // keeps the dependency one-way and the tab files independently testable.
  renderers[tab](panel, data, {
    reload: (nextTab) => reloadCompetition(nextTab || tab),
    goto,
    meta: store.meta,
    onCleanup: (fn) => tabCleanups.push(fn),
  });
  applyTranslations(main);
  if (keepScroll) window.scrollTo({ top: scrollY });
}

// --- boot --------------------------------------------------------------

function setWhoami(name) {
  const node = $('#whoami');
  if (node) node.textContent = t('nav.signedInAs', { name });
}

async function boot() {
  let session;
  try {
    session = await api.get('/api/auth/me');
  } catch {
    session = { user: null };
  }
  if (!session.user) {
    location.replace('/login');
    return;
  }
  store.user = session.user;
  store.meta = await api.get('/api/meta').catch(() => ({ templates: [] }));

  await initI18n(session.user.locale);
  mountLanguagePicker($('#langpick'), {
    onChange: (locale) => {
      // Remember the organizer's language on their account, not just locally.
      void api.patch('/api/auth/me', { locale }).catch(() => {});
    },
  });

  setWhoami(session.user.name);
  // Superadmins are ordinary organizers here; the platform-wide view is a
  // separate page, reachable only when the role actually grants it.
  if (session.user.role === 'superadmin') {
    $('#whoami')?.before(
      el('a', { class: 'btn btn--sm btn--ghost', href: '/sysadmin', text: t('sys.link') }),
    );
  }
  $('#signout')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    await api.post('/api/auth/logout').catch(() => {});
    location.assign('/');
  });

  onLocaleChange(() => {
    setWhoami(store.user.name);
    void route();
  });

  window.addEventListener('popstate', () => void route());
  await route();
}

void boot();
