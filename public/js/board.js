import { api, ApiError } from './api.js';
import { $, el, replace } from './dom.js';
import { applyTranslations, fmtNumber, initI18n, onLocaleChange, t } from './i18n.js';
import { mountLanguagePicker } from './lang.js';
import { subscribeBoard } from './live.js';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const main = $('#main');
const liveStateHost = $('#livestate');

let board = null;
let trackFilter = 'all';
let connection = null;

// --- rendering ---------------------------------------------------------

function render() {
  if (!board) return;
  document.title = `${board.competition.name} — ${t('app.name')}`;

  const rows = board.rows.filter((row) => trackFilter === 'all' || row.trackId === trackFilter);
  const scale = rows.reduce((max, row) => (row.score !== null && row.score > max ? row.score : max), 0);

  const head = el(
    'div',
    { class: 'stack stack--tight' },
    el('h1', { text: board.competition.name }),
    board.competition.status === 'closed' && el('span', { class: 'badge badge--soft', text: t('board.final') }),
    el('p', {
      class: 'muted',
      text: t('board.judgesDone', { done: board.stats.judgesCompleted, total: board.stats.judgeCount }),
    }),
    judgeProgressBar(),
  );

  const blocks = [head];

  if (board.tracks.length > 0) blocks.push(trackChips());

  if (rows.length === 0) {
    blocks.push(el('div', { class: 'empty', text: t('board.noEntries') }));
  } else if (scale === 0 && board.competition.showScores) {
    blocks.push(el('div', { class: 'empty', text: t('board.waiting') }), boardCard(rows, scale));
  } else {
    blocks.push(boardCard(rows, scale));
  }

  replace(main, ...blocks.filter(Boolean));
  applyTranslations(main);
}

function judgeProgressBar() {
  const total = board.stats.judgeCount || 0;
  const pct = total ? (board.stats.judgesCompleted / total) * 100 : 0;
  const fill = el('span', { class: 'progress__fill' });
  fill.style.width = `${pct}%`;
  return el(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    fill,
  );
}

function trackChips() {
  const options = [{ id: 'all', name: t('board.track.all') }, ...board.tracks];
  return el(
    'div',
    { class: 'chip-row' },
    ...options.map((track) =>
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-selected': trackFilter === track.id ? 'true' : 'false',
        text: track.name,
        onclick: () => {
          trackFilter = track.id;
          render();
        },
      }),
    ),
  );
}

function boardCard(rows, scale) {
  return el(
    'section',
    { class: 'card' },
    ...rows.map((row) => boardRow(row, scale)),
  );
}

function boardRow(row, scale) {
  const scored = row.scored;
  const showScores = board.competition.showScores;
  // Bars are relative to the leader so the room can read the gap at a glance.
  const pct = scored && scale > 0 ? Math.max(2, (row.score / scale) * 100) : 0;

  const fill = el('span', { class: 'progress__fill' });
  fill.style.width = `${pct}%`;

  const scoreText = !scored ? '–' : showScores ? fmtNumber(row.score) : '✓';

  return el(
    'div',
    { class: `board-row${scored ? '' : ' board-row--unscored'}` },
    el('div', { class: 'board-row__rank', text: row.rank === null ? '' : String(row.rank) }),
    el(
      'div',
      {},
      el(
        'div',
        { class: 'board-row__top' },
        el(
          'div',
          { class: 'board-row__name' },
          row.name,
          row.teamName && el('span', { class: 'board-row__team', text: ` — ${row.teamName}` }),
          row.trackName && trackFilter === 'all' && el('span', { class: 'board-row__team', text: ` · ${row.trackName}` }),
        ),
        el('div', {
          class: 'board-row__score',
          text: scoreText,
          title: scored ? t('results.judges') + `: ${row.judgesScored}/${row.judgesEligible}` : t('results.unscored'),
        }),
      ),
      el('div', { class: 'progress board-row__bar' }, fill),
    ),
  );
}

// --- live status -------------------------------------------------------

function renderLiveState(status) {
  const label = {
    live: t('state.live'),
    polling: t('state.polling'),
    reconnecting: t('state.reconnecting'),
    offline: t('error.network'),
  }[status];
  const dotClass = status === 'live' ? 'dot dot--live' : status === 'offline' ? 'dot dot--warn' : 'dot dot--idle';
  replace(
    liveStateHost,
    el('span', { class: dotClass, 'aria-hidden': 'true' }),
    el('span', { class: 'small muted nowrap', text: label || '' }),
  );
}

// --- full screen -------------------------------------------------------

function setupFullscreen() {
  const button = $('#fullscreen');
  const sync = () => {
    const on = Boolean(document.fullscreenElement);
    button.textContent = on ? t('action.exitFullscreen') : t('action.fullscreen');
    document.body.classList.toggle('board--stage', on);
  };
  button.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Some browsers refuse without a user gesture chain; fall back to just
      // scaling the board up so the demo-room screen still reads well.
      document.body.classList.toggle('board--stage');
      sync();
    }
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
}

// --- boot --------------------------------------------------------------

function renderFailure(titleKey, bodyKey) {
  replace(
    main,
    el(
      'section',
      { class: 'card stack stack--tight' },
      el('h1', { text: t(titleKey) }),
      el('p', { class: 'muted', text: t(bodyKey) }),
    ),
  );
}

async function boot() {
  await initI18n();
  mountLanguagePicker($('#langpick'));
  setupFullscreen();
  onLocaleChange(() => {
    render();
    syncFullscreenLabel();
  });

  try {
    board = await api.get(`/api/board/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return renderFailure('board.notPublic.title', 'board.notPublic.body');
    if (err instanceof ApiError && err.status === 404) return renderFailure('board.notFound.title', 'board.notFound.body');
    return renderFailure('state.error', 'error.generic');
  }

  render();

  connection = subscribeBoard({
    streamUrl: `/api/board/${encodeURIComponent(slug)}/live`,
    pollUrl: `/api/board/${encodeURIComponent(slug)}`,
    onBoard: (next) => {
      board = next;
      render();
    },
    onStatus: renderLiveState,
  });

  window.addEventListener('pagehide', () => connection?.stop());
}

function syncFullscreenLabel() {
  const button = $('#fullscreen');
  if (button) {
    button.textContent = document.fullscreenElement ? t('action.exitFullscreen') : t('action.fullscreen');
  }
}

void boot();
