import { api, ApiError } from './api.js';
import { $, clear, el, debounce, replace, setBusy } from './dom.js';
import { applyTranslations, fmtDateTime, fmtNumber, getLocale, initI18n, onLocaleChange, setLocale, t } from './i18n.js';
import { mountLanguagePicker } from './lang.js';

const token = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const HELP_DISMISS_KEY = `judgium.help.${token}`;
const main = $('#main');

let state = null;      // last payload from the server
let index = 0;         // which entry is on screen
let helpDismissed = readHelpDismissed();

// --- persistence --------------------------------------------------------

function readHelpDismissed() {
  try {
    return localStorage.getItem(HELP_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissHelp() {
  helpDismissed = true;
  try {
    localStorage.setItem(HELP_DISMISS_KEY, '1');
  } catch {
    /* private browsing - the hint comes back next time, which is harmless */
  }
  render();
}

// --- save queue --------------------------------------------------------
//
// One in-flight PATCH per entry, with the newest pending patch merged in.
// A judge tabbing quickly through criteria therefore produces a small number
// of requests, and a failed save is retried without losing later keystrokes.

const pending = new Map();   // entryId -> { scores, notes }
const inFlight = new Set();
let saveState = { kind: 'idle', at: null };

function setSaveState(kind, extra = {}) {
  saveState = { kind, at: new Date().toISOString(), ...extra };
  const node = $('#savestate');
  if (node) renderSaveState(node);
}

function renderSaveState(node) {
  node.classList.toggle('save-state--error', saveState.kind === 'error');
  if (saveState.kind === 'saving') node.textContent = t('state.saving');
  else if (saveState.kind === 'saved') node.textContent = t('state.saved');
  else if (saveState.kind === 'error') node.textContent = saveState.message || t('judge.saveError');
  else node.textContent = '';
}

function queuePatch(entryId, patch) {
  const existing = pending.get(entryId) || {};
  const merged = { ...existing, ...patch };
  if (patch.scores) merged.scores = { ...(existing.scores || {}), ...patch.scores };
  pending.set(entryId, merged);
  setSaveState('saving');
  void flush(entryId);
}

async function flush(entryId) {
  if (inFlight.has(entryId)) return;
  const patch = pending.get(entryId);
  if (!patch) return;
  pending.delete(entryId);
  inFlight.add(entryId);

  try {
    const result = await api.patch(`/api/judge/${encodeURIComponent(token)}/entries/${entryId}`, patch);
    applySaveResult(entryId, result);
    setSaveState('saved');
  } catch (err) {
    // Put the patch back so the next attempt still carries it, unless the
    // server rejected it outright - retrying an invalid value would loop.
    const permanent = err instanceof ApiError && err.status >= 400 && err.status < 500;
    if (!permanent) {
      const later = pending.get(entryId) || {};
      pending.set(entryId, { ...patch, ...later, scores: { ...(patch.scores || {}), ...(later.scores || {}) } });
      setTimeout(() => void flush(entryId), 2500);
    }
    setSaveState('error', { message: err instanceof ApiError ? err.userMessage : t('judge.saveError') });
    if (permanent) void reload();
  } finally {
    inFlight.delete(entryId);
    if (pending.has(entryId)) void flush(entryId);
  }
}

function applySaveResult(entryId, result) {
  const entry = state?.entries.find((e) => e.id === entryId);
  if (!entry || !result?.entry) return;
  Object.assign(entry, {
    total: result.entry.total,
    filled: result.entry.filled,
    complete: result.entry.complete,
  });
  if (result.progress) state.progress = result.progress;
  renderProgress();
  renderEntryChips();
  renderTotals();
}

// --- data --------------------------------------------------------------

async function reload() {
  state = await api.get(`/api/judge/${encodeURIComponent(token)}`);
  if (index >= state.entries.length) index = Math.max(0, state.entries.length - 1);
  render();
}

// --- rendering ---------------------------------------------------------

function render() {
  if (!state) return;
  const { competition, judge } = state;
  // Judges often have several scorecards open at once; name the tab.
  document.title = `${competition.name} — ${t('app.name')}`;

  const header = el(
    'div',
    { class: 'stack stack--tight' },
    el('h1', { text: t('judge.welcome', { name: judge.name }) }),
    el('p', { class: 'muted', text: t('judge.scoring', { competition: competition.name }) }),
  );

  const blocks = [header];

  if (competition.status === 'closed') blocks.push(closedNotice());
  else if (judge.completedAt) blocks.push(completedNotice());

  if (state.entries.length === 0) {
    blocks.push(emptyNotice('judge.empty.title', 'judge.empty.body'));
  } else if (state.entries[index] && state.entries[index].criterionIds.length === 0) {
    blocks.push(progressCard(), emptyNotice(null, 'judge.noCriteria'));
  } else {
    blocks.push(progressCard());
    if (!helpDismissed && state.writable) blocks.push(helpNotice());
    blocks.push(navCard(), scoreCard(), footerNav());
    if (state.writable) blocks.push(completeCard());
  }

  replace(main, ...blocks);
  applyTranslations(main);
}

function progressCard() {
  const pct = state.progress.total ? (state.progress.scored / state.progress.total) * 100 : 0;
  const fill = el('span', { class: 'progress__fill' });
  fill.style.width = `${pct}%`;

  return el(
    'section',
    { class: 'card stack stack--tight', id: 'progresscard' },
    el(
      'div',
      { class: 'row row--between' },
      el('h2', { text: t('judge.progress') }),
      el('span', {
        class: 'badge',
        id: 'progressbadge',
        text: t('judge.progress.count', { scored: state.progress.scored, total: state.progress.total }),
      }),
    ),
    el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill),
  );
}

function renderProgress() {
  const card = $('#progresscard');
  if (!card) return;
  const pct = state.progress.total ? (state.progress.scored / state.progress.total) * 100 : 0;
  $('#progressbadge', card).textContent = t('judge.progress.count', {
    scored: state.progress.scored,
    total: state.progress.total,
  });
  const bar = card.querySelector('.progress');
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  bar.querySelector('.progress__fill').style.width = `${pct}%`;
}

function helpNotice() {
  return el(
    'section',
    { class: 'notice' },
    el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: 'i' }),
    el(
      'div',
      { class: 'notice__body' },
      el('strong', { text: t('judge.help.title') }),
      ' ',
      el('span', { text: t('judge.help.body') }),
    ),
    el('button', {
      class: 'btn btn--sm btn--ghost',
      type: 'button',
      'aria-label': t('action.close'),
      text: '✕',
      onclick: dismissHelp,
    }),
  );
}

function closedNotice() {
  return el(
    'section',
    { class: 'notice notice--warn' },
    el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '!' }),
    el(
      'div',
      { class: 'notice__body' },
      el('strong', { text: t('judge.closed.title') }),
      el('p', { class: 'small', text: t('judge.closed.body') }),
    ),
  );
}

function completedNotice() {
  return el(
    'section',
    { class: 'notice' },
    el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '✓' }),
    el(
      'div',
      { class: 'notice__body stack stack--tight' },
      el('strong', { text: t('judge.completed.title') }),
      el('p', { class: 'small', text: t('judge.completed.body', { when: fmtDateTime(state.judge.completedAt) }) }),
      el('div', {}, el('button', { class: 'btn btn--sm btn--outline', type: 'button', text: t('judge.reopen'), onclick: reopen })),
    ),
  );
}

function emptyNotice(titleKey, bodyKey) {
  return el(
    'section',
    { class: 'card stack stack--tight center' },
    titleKey && el('h2', { text: t(titleKey) }),
    el('p', { class: 'muted', text: t(bodyKey) }),
  );
}

function navCard() {
  const entry = state.entries[index];
  return el(
    'section',
    { class: 'card stack', id: 'navcard' },
    el(
      'div',
      { class: 'entry-nav' },
      el('button', {
        class: 'btn btn--icon',
        type: 'button',
        text: '‹',
        'aria-label': t('action.previous'),
        disabled: index === 0,
        onclick: () => go(index - 1),
      }),
      el(
        'div',
        { class: 'entry-nav__title' },
        el('strong', { text: entry.name }),
        el('span', { text: t('judge.entry.of', { index: index + 1, total: state.entries.length }) }),
      ),
      el('button', {
        class: 'btn btn--icon',
        type: 'button',
        text: '›',
        'aria-label': t('action.next'),
        disabled: index >= state.entries.length - 1,
        onclick: () => go(index + 1),
      }),
    ),
    entryChips(),
  );
}

function entryChips() {
  // Above a few dozen entries a chip strip stops being useful, so switch to a
  // select. Entry counts are unlimited, and a 200-team event must still work.
  if (state.entries.length > 24) {
    return el(
      'div',
      { class: 'field', id: 'entrychips' },
      el(
        'select',
        {
          'aria-label': t('results.entry'),
          onchange: (event) => go(Number(event.target.value)),
        },
        ...state.entries.map((entry, i) =>
          el('option', {
            value: i,
            selected: i === index,
            text: `${entry.complete ? '✓ ' : ''}${i + 1}. ${entry.name}`,
          }),
        ),
      ),
    );
  }

  return el(
    'div',
    { class: 'chip-row', id: 'entrychips' },
    ...state.entries.map((entry, i) =>
      el('button', {
        class: `chip${entry.complete && i !== index ? ' chip--done' : ''}`,
        type: 'button',
        'aria-selected': i === index ? 'true' : 'false',
        text: entry.complete && i !== index ? `✓ ${entry.name}` : entry.name,
        onclick: () => go(i),
      }),
    ),
  );
}

function renderEntryChips() {
  const host = $('#entrychips');
  if (host) host.replaceWith(entryChips());
}

function scoreCard() {
  const entry = state.entries[index];
  const criteria = entry.criterionIds.map((id) => state.criteria.find((c) => c.id === id)).filter(Boolean);
  const readOnly = !state.writable;

  const rows = criteria.map((criterion) => {
    const value = entry.scores[criterion.id];
    const input = el('input', {
      type: 'number',
      inputmode: state.competition.allowDecimals ? 'decimal' : 'numeric',
      step: state.competition.allowDecimals ? '0.5' : '1',
      min: '0',
      max: String(criterion.maxScore),
      value: value === null || value === undefined ? '' : String(value),
      placeholder: `0–${fmtNumber(criterion.maxScore)}`,
      disabled: readOnly,
      'aria-label': `${criterion.name} (0-${criterion.maxScore})`,
      oninput: (event) => onScoreInput(entry, criterion, event.target),
      onblur: (event) => onScoreInput(entry, criterion, event.target, { immediate: true }),
    });

    const row = el(
      'div',
      { class: `criterion${value === null || value === undefined ? '' : ' criterion--filled'}`, dataset: { criterion: criterion.id } },
      el(
        'div',
        { class: 'criterion__label' },
        el('div', { class: 'criterion__name', text: criterion.name }),
        criterion.description && el('div', { class: 'criterion__desc', text: criterion.description }),
      ),
      el(
        'div',
        { class: 'criterion__input' },
        input,
        el('span', { class: 'criterion__max', text: `/ ${fmtNumber(criterion.maxScore)}` }),
      ),
    );
    return row;
  });

  const blocks = [
    entry.trackName && el('p', { class: 'small muted', text: t('judge.track', { name: entry.trackName }) }),
    entry.teamName && el('p', { class: 'small muted', text: entry.teamName }),
    entry.description && el('p', { class: 'small', text: entry.description }),
    linkRow(entry),
    ...rows,
  ];

  if (state.competition.allowNotes) blocks.push(el('hr'), notesBlock(entry, readOnly));
  blocks.push(
    el(
      'div',
      { class: 'row row--between' },
      el('span', { class: 'save-state', id: 'savestate' }),
      el('span', { class: 'small muted', id: 'entrytotal' }),
    ),
  );

  const card = el('section', { class: 'card stack stack--tight', id: 'scorecard' }, ...blocks.filter(Boolean));
  queueMicrotask(() => {
    const node = $('#savestate', card);
    if (node) renderSaveState(node);
    renderTotals();
  });
  return card;
}

function linkRow(entry) {
  const links = [
    entry.projectUrl && el('a', { href: entry.projectUrl, target: '_blank', rel: 'noopener noreferrer', text: t('entries.projectUrl') }),
    entry.videoUrl && el('a', { href: entry.videoUrl, target: '_blank', rel: 'noopener noreferrer', text: t('entries.videoUrl') }),
    entry.tableLabel && el('span', { class: 'badge badge--muted', text: `${t('entries.table')} ${entry.tableLabel}` }),
  ].filter(Boolean);
  return links.length ? el('div', { class: 'row small' }, ...links) : null;
}

function notesBlock(entry, readOnly) {
  const max = state.competition.notesMaxLength;
  const counter = el('div', { class: 'char-count', text: `${entry.notes.length} / ${max}` });
  const area = el('textarea', {
    maxlength: String(max),
    placeholder: t('judge.notes.placeholder'),
    disabled: readOnly,
    value: entry.notes,
    'aria-label': t('judge.notes'),
    oninput: (event) => {
      entry.notes = event.target.value;
      counter.textContent = `${entry.notes.length} / ${max}`;
      saveNotes(entry);
    },
    onblur: () => saveNotes.flush(entry),
  });

  return el(
    'div',
    { class: 'stack stack--tight' },
    el('label', { class: 'label', text: t('judge.notes') }),
    area,
    counter,
  );
}

function renderTotals() {
  const node = $('#entrytotal');
  if (!node || !state) return;
  const entry = state.entries[index];
  if (!entry) return;
  node.textContent = t('judge.total', { total: fmtNumber(entry.total), max: fmtNumber(entry.maxTotal) });
}

function footerNav() {
  const atFirst = index === 0;
  const atLast = index >= state.entries.length - 1;
  return el(
    'section',
    { class: 'grid-2' },
    el('button', {
      class: 'btn btn--block',
      type: 'button',
      disabled: atFirst,
      text: atFirst ? t('judge.first') : `‹ ${t('action.previous')}`,
      onclick: () => go(index - 1),
    }),
    el('button', {
      class: 'btn btn--block btn--outline',
      type: 'button',
      disabled: atLast,
      text: atLast ? t('judge.last') : `${t('action.next')} ›`,
      onclick: () => go(index + 1),
    }),
  );
}

function completeCard() {
  const message = el('div', { class: 'stack stack--tight' });
  const button = el('button', {
    class: 'btn btn--primary btn--block',
    type: 'button',
    text: t('judge.markComplete'),
    onclick: (event) => markComplete(event.currentTarget, message, false),
  });
  return el('section', { class: 'card stack' }, button, message);
}

// --- interactions ------------------------------------------------------

function go(next) {
  if (next < 0 || next >= state.entries.length) return;
  saveNotes.flush(state.entries[index]);
  index = next;
  render();
  main.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

const pendingScores = new Map();   // entryId -> { criterionId: value }
const scoreDebouncers = new Map(); // entryId -> debounced flusher

function onScoreInput(entry, criterion, input, { immediate = false } = {}) {
  const raw = input.value.trim();
  const row = input.closest('.criterion');

  if (raw === '') {
    entry.scores[criterion.id] = null;
    row?.classList.remove('criterion--filled');
    stageScore(entry.id, criterion.id, null, immediate);
    return;
  }

  let value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value)) return; // let the judge keep typing
  if (!state.competition.allowDecimals) value = Math.round(value);
  // Clamp in the UI as well as on the server so the field never shows a value
  // the leaderboard will not honour.
  if (value < 0) value = 0;
  if (value > criterion.maxScore) {
    value = criterion.maxScore;
    input.value = String(value);
  }

  entry.scores[criterion.id] = value;
  row?.classList.add('criterion--filled');
  stageScore(entry.id, criterion.id, value, immediate);
}

/**
 * Collects criterion edits per entry and sends them as one PATCH once typing
 * settles - a judge tabbing through six fields makes one request, not six.
 * `immediate` is used on blur so leaving a field always commits it.
 */
function stageScore(entryId, criterionId, value, immediate) {
  const staged = pendingScores.get(entryId) || {};
  staged[criterionId] = value;
  pendingScores.set(entryId, staged);

  const send = () => {
    const batch = pendingScores.get(entryId);
    pendingScores.delete(entryId);
    if (batch && Object.keys(batch).length > 0) queuePatch(entryId, { scores: batch });
  };

  if (!scoreDebouncers.has(entryId)) scoreDebouncers.set(entryId, debounce(send, 450));
  const debounced = scoreDebouncers.get(entryId);

  if (immediate) {
    debounced.flush();
    send();
  } else {
    debounced();
  }
}

const notesSavers = new Map();
function notesSaverFor(entryId) {
  if (!notesSavers.has(entryId)) {
    notesSavers.set(
      entryId,
      debounce((notes) => queuePatch(entryId, { notes }), 800),
    );
  }
  return notesSavers.get(entryId);
}

function saveNotes(entry) {
  notesSaverFor(entry.id)(entry.notes);
}
saveNotes.flush = (entry) => {
  if (!entry) return;
  notesSavers.get(entry.id)?.flush(entry.notes);
};

async function markComplete(button, messageHost, force) {
  // Push anything still queued before submitting, so nothing is lost.
  for (const entry of state.entries) saveNotes.flush(entry);
  for (const entryId of [...pendingScores.keys()]) {
    const batch = pendingScores.get(entryId);
    pendingScores.delete(entryId);
    if (batch) queuePatch(entryId, { scores: batch });
  }

  setBusy(button, true, t('state.saving'));
  clear(messageHost);
  try {
    await api.post(`/api/judge/${encodeURIComponent(token)}/complete`, force ? { force: true } : {});
    await reload();
  } catch (err) {
    setBusy(button, false);
    if (err instanceof ApiError && err.code === 'incomplete_scorecard') {
      const names = (err.details?.unfinished || []).map((e) => `${e.name} (${e.filled}/${e.of})`).join(', ');
      replace(
        messageHost,
        el(
          'div',
          { class: 'notice notice--warn' },
          el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '!' }),
          el(
            'div',
            { class: 'notice__body stack stack--tight' },
            el('strong', { text: t('judge.incomplete.title') }),
            el('p', { class: 'small', text: t('judge.incomplete.body', { entries: names }) }),
            el(
              'div',
              {},
              el('button', {
                class: 'btn btn--sm btn--outline',
                type: 'button',
                text: t('judge.incomplete.submitAnyway'),
                onclick: (event) => markComplete(event.currentTarget, messageHost, true),
              }),
            ),
          ),
        ),
      );
      return;
    }
    replace(
      messageHost,
      el('p', { class: 'small save-state--error', text: err instanceof ApiError ? err.userMessage : t('error.generic') }),
    );
  }
}

async function reopen() {
  try {
    await api.post(`/api/judge/${encodeURIComponent(token)}/reopen`);
    await reload();
  } catch (err) {
    setSaveState('error', { message: err instanceof ApiError ? err.userMessage : t('error.generic') });
  }
}

// --- boot --------------------------------------------------------------

function renderInvalidLink() {
  replace(
    main,
    el(
      'section',
      { class: 'card stack stack--tight' },
      el('h1', { text: t('judge.invalidLink.title') }),
      el('p', { class: 'muted', text: t('judge.invalidLink.body') }),
    ),
  );
}

async function boot() {
  await initI18n();

  let payload = null;
  try {
    payload = await api.get(`/api/judge/${encodeURIComponent(token)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return renderInvalidLink();
    replace(main, el('p', { class: 'save-state--error', text: err instanceof ApiError ? err.userMessage : t('error.generic') }));
    return;
  }

  state = payload;
  // A judge's stored language preference travels with their link, so opening
  // it on a second device keeps the language they picked.
  if (state.judge.locale && state.judge.locale !== getLocale()) {
    await setLocale(state.judge.locale);
  }

  mountLanguagePicker($('#langpick'), {
    onChange: (locale) => {
      void api.post(`/api/judge/${encodeURIComponent(token)}/locale`, { locale }).catch(() => {});
      render();
    },
  });
  onLocaleChange(() => render());

  render();

  // Flush anything queued if the judge closes the tab mid-keystroke.
  window.addEventListener('pagehide', () => {
    for (const entry of state?.entries || []) saveNotes.flush(entry);
  });
}

void boot();
