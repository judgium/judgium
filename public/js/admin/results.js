import { api } from '../api.js';
import { el, replace } from '../dom.js';
import { fmtNumber, t } from '../i18n.js';
import { select, trackName } from './shared.js';
import { subscribeBoard } from '../live.js';

export function renderResultsTab(host, data, ctx) {
  const c = data.competition;
  let filter = 'all';
  let expanded = null;

  const listHost = el('div', {});
  const liveHost = el('span', { class: 'row row--nowrap' });

  // Keep a mutable copy of the ranked rows so live pushes can refresh the
  // table without re-fetching the whole competition detail payload.
  let rows = data.results.rows;
  let stats = data.results.stats;

  const draw = () => {
    const visible = rows.filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'none') return !row.trackId;
      return row.trackId === filter;
    });

    if (visible.length === 0) {
      replace(listHost, el('div', { class: 'empty', text: t('results.empty') }));
      return;
    }

    const body = [];
    for (const row of visible) {
      body.push(resultRow(row, data, () => {
        expanded = expanded === row.id ? null : row.id;
        draw();
      }));
      if (expanded === row.id) body.push(breakdownRow(row, data));
    }

    replace(
      listHost,
      el(
        'div',
        { class: 'table-scroll' },
        el(
          'table',
          { class: 'data' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { class: 'num', text: t('results.rank') }),
              el('th', { text: t('results.entry') }),
              data.tracks.length ? el('th', { text: t('results.track') }) : null,
              el('th', { class: 'num', text: t('results.score') }),
              el('th', { class: 'num', text: t('results.judges') }),
              c.dropHighLow ? el('th', { class: 'num', text: t('results.dropped') }) : null,
              el('th', { text: '' }),
            ),
          ),
          el('tbody', {}, ...body),
        ),
      ),
    );
  };

  const progressLine = el('p', { class: 'small muted' });
  const drawProgress = () => {
    progressLine.textContent = `${t('results.judgesDone', {
      done: stats.judgesCompleted,
      total: stats.judgeCount,
    })} · ${t('results.progress', {
      filled: stats.filledCells,
      expected: stats.expectedCells,
      percent: fmtNumber(stats.progress),
    })}`;
  };
  drawProgress();

  const filterOptions = [
    { value: 'all', label: t('results.filter.all') },
    ...data.tracks.map((track) => ({ value: track.id, label: track.name })),
    ...(data.tracks.length ? [{ value: 'none', label: t('entries.noTrack') }] : []),
  ];

  const exportRow = el(
    'div',
    { class: 'row' },
    exportLink(c.id, 'leaderboard.csv', t('results.export.leaderboard')),
    exportLink(c.id, 'entries.csv', t('results.export.entries')),
    exportLink(c.id, 'per-judge.csv', t('results.export.perJudge')),
    exportLink(c.id, 'notes.csv', t('results.export.notes')),
    exportLink(c.id, 'full.json', t('results.export.full')),
  );

  draw();

  replace(
    host,
    el(
      'section',
      { class: 'card stack' },
      el(
        'div',
        { class: 'card__head' },
        el('div', { class: 'stack stack--tight' }, el('h2', { text: t('results.title') }), progressLine),
        liveHost,
      ),
      el(
        'div',
        { class: 'row row--between' },
        data.tracks.length
          ? el(
              'div',
              {},
              select(filter, filterOptions, (value) => {
                filter = value;
                draw();
              }),
            )
          : el('span', {}),
        el(
          'div',
          { class: 'row' },
          el('a', {
            class: 'btn btn--sm btn--outline',
            href: `/board/${c.slug}`,
            target: '_blank',
            rel: 'noopener',
            text: t('results.openBoard'),
          }),
        ),
      ),
      listHost,
    ),
    el('section', { class: 'card stack' }, el('h2', { text: t('action.export') }), exportRow),
  );

  const refresh = async () => {
    try {
      const next = await api.get(`/api/competitions/${c.id}/results`);
      rows = next.rows;
      stats = next.stats;
      drawProgress();
      draw();
    } catch {
      /* the next push or poll will retry */
    }
  };

  // Live-update the organizer's table so this tab can be left open on a second
  // screen during judging. The SSE stream carries the public board shape, which
  // omits per-judge detail, so a push triggers a refetch of the full results;
  // the polling fallback already returns everything and is used as-is.
  const connection = subscribeBoard({
    streamUrl: `/api/competitions/${c.id}/live`,
    pollUrl: `/api/competitions/${c.id}/results`,
    onBoard: (payload) => {
      const hasJudgeDetail = payload.rows?.length === 0 || Array.isArray(payload.rows?.[0]?.judgeScores);
      if (hasJudgeDetail) {
        rows = payload.rows;
        stats = payload.stats;
        drawProgress();
        draw();
      } else {
        void refresh();
      }
    },
    onStatus: (status) => drawLiveState(liveHost, status),
  });
  ctx.onCleanup?.(() => connection.stop());
}

function drawLiveState(hostNode, status) {
  const label = {
    live: t('state.live'),
    polling: t('state.polling'),
    reconnecting: t('state.reconnecting'),
    offline: t('error.network'),
  }[status];
  replace(
    hostNode,
    el('span', { class: status === 'live' ? 'dot dot--live' : 'dot dot--idle', 'aria-hidden': 'true' }),
    el('span', { class: 'small muted nowrap', text: label || '' }),
  );
}

function resultRow(row, data, onToggle) {
  return el(
    'tr',
    {},
    el('td', { class: 'num tabnum', text: row.rank === null ? '–' : String(row.rank) }),
    el(
      'td',
      {},
      el('div', { class: 'break', text: row.name }),
      row.teamName && el('div', { class: 'small muted break', text: row.teamName }),
    ),
    data.tracks.length ? el('td', { class: 'small muted', text: trackName(data, row.trackId) }) : null,
    el('td', {
      class: 'num tabnum',
      text: row.score === null ? t('results.unscored') : `${fmtNumber(row.score)} / ${fmtNumber(row.maxScore)}`,
    }),
    el('td', { class: 'num tabnum small muted', text: `${row.judgesScored} / ${row.judgesEligible}` }),
    data.competition.dropHighLow
      ? el('td', {
          class: 'num tabnum small muted',
          text:
            row.droppedHigh === null
              ? '–'
              : `${fmtNumber(row.droppedHigh)} / ${fmtNumber(row.droppedLow)}`,
        })
      : null,
    el(
      'td',
      {},
      el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        text: t('results.breakdown'),
        onclick: onToggle,
      }),
    ),
  );
}

function breakdownRow(row, data) {
  const criteria = data.criteria.filter((k) => !k.trackId || k.trackId === row.trackId);
  const notesFor = (judgeId) =>
    data.notes.find((note) => note.judgeId === judgeId && note.entryId === row.id)?.body || '';

  const colSpan = 5 + (data.tracks.length ? 1 : 0) + (data.competition.dropHighLow ? 1 : 0);

  if (row.judgeScores.length === 0) {
    return el('tr', {}, el('td', { colspan: String(colSpan) }, el('p', { class: 'small muted', text: t('results.breakdown.empty') })));
  }

  const inner = el(
    'table',
    { class: 'data' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { text: t('results.breakdown.judge') }),
        ...criteria.map((k) => el('th', { class: 'num', text: `${k.name} /${fmtNumber(k.maxScore)}` })),
        el('th', { class: 'num', text: t('results.breakdown.total') }),
        el('th', { text: t('results.breakdown.notes') }),
      ),
    ),
    el(
      'tbody',
      {},
      ...row.judgeScores.map((js) =>
        el(
          'tr',
          {},
          el('td', { class: 'break', text: js.judgeName }),
          ...criteria.map((k) =>
            el('td', {
              class: 'num tabnum',
              text: js.values[k.id] === null || js.values[k.id] === undefined ? '–' : fmtNumber(js.values[k.id]),
            }),
          ),
          el('td', { class: 'num tabnum', text: fmtNumber(js.total) }),
          el('td', { class: 'small muted break', text: notesFor(js.judgeId) || '–' }),
        ),
      ),
    ),
  );

  return el(
    'tr',
    {},
    el('td', { colspan: String(colSpan) }, el('div', { class: 'table-scroll' }, inner)),
  );
}

function exportLink(competitionId, file, label) {
  return el('a', {
    class: 'btn btn--sm',
    href: `/api/competitions/${competitionId}/export/${file}`,
    download: '',
    text: label,
  });
}
