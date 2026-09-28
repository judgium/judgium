import { api } from '../api.js';
import { copyToClipboard, el, flashLabel, replace } from '../dom.js';
import { fmtDateTime, t } from '../i18n.js';
import { confirmAction, field, linkRow, notice, openModal, showError } from './shared.js';

export function renderJudgesTab(host, data, ctx) {
  const errorHost = el('div', {});

  // Per-judge progress comes from the results payload so the organizer can see
  // who has actually started without opening anyone's private link.
  const scoredByJudge = new Map();
  const completeByJudge = new Map();
  for (const row of data.results.rows) {
    for (const js of row.judgeScores) {
      scoredByJudge.set(js.judgeId, (scoredByJudge.get(js.judgeId) || 0) + 1);
      if (js.complete) completeByJudge.set(js.judgeId, (completeByJudge.get(js.judgeId) || 0) + 1);
    }
  }
  const eligibleCount = (judge) =>
    data.entries.filter((entry) => judge.trackIds.length === 0 || !entry.trackId || judge.trackIds.includes(entry.trackId))
      .length;

  const head = el(
    'div',
    { class: 'card__head' },
    el(
      'div',
      { class: 'stack stack--tight' },
      el('h2', { text: t('judges.title') }),
      el('p', { class: 'card__hint', text: t('judges.help') }),
    ),
    el('span', { class: 'badge badge--soft', text: t('dash.card.judges', { n: data.judges.length }) }),
  );

  const controls = el(
    'div',
    { class: 'row row--between' },
    data.judges.length
      ? el('button', {
          class: 'btn btn--sm',
          type: 'button',
          text: t('judges.copyAll'),
          onclick: async (event) => {
            const text = data.judges.map((judge) => `${judge.name}\t${judge.link}`).join('\n');
            const ok = await copyToClipboard(text);
            flashLabel(event.currentTarget, ok ? t('action.copied') : t('state.error'));
          },
        })
      : el('span', {}),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn btn--primary',
        type: 'button',
        text: t('judges.add'),
        onclick: () => openJudgeDialog(data, ctx, null),
      }),
      el('button', { class: 'btn', type: 'button', text: t('judges.bulk'), onclick: () => openBulkDialog(data, ctx) }),
    ),
  );

  const list = data.judges.length
    ? el(
        'div',
        { class: 'list' },
        ...data.judges.map((judge) =>
          judgeCard(judge, data, ctx, errorHost, {
            scored: scoredByJudge.get(judge.id) || 0,
            total: eligibleCount(judge),
          }),
        ),
      )
    : el('div', { class: 'empty', text: t('judges.empty') });

  replace(host, errorHost, el('section', { class: 'card stack' }, head, controls, list));
}

function judgeCard(judge, data, ctx, errorHost, progress) {
  const c = data.competition;
  const status = judge.completedAt ? 'done' : progress.scored > 0 ? 'inProgress' : 'notStarted';
  const badgeClass = status === 'done' ? 'badge' : status === 'inProgress' ? 'badge badge--soft' : 'badge badge--muted';

  const call = async (fn) => {
    replace(errorHost);
    try {
      await fn();
      await ctx.reload();
    } catch (err) {
      showError(errorHost, err);
    }
  };

  const trackLabel = judge.trackIds.length
    ? judge.trackIds.map((id) => data.tracks.find((track) => track.id === id)?.name).filter(Boolean).join(', ')
    : t('judges.tracks.all');

  const actions = el(
    'div',
    { class: 'row' },
    el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: t('action.edit'),
      onclick: () => openJudgeDialog(data, ctx, judge),
    }),
    judge.completedAt
      ? el('button', {
          class: 'btn btn--sm btn--outline',
          type: 'button',
          text: t('judges.reopen'),
          onclick: () => call(() => api.post(`/api/competitions/${c.id}/judges/${judge.id}/reopen`)),
        })
      : null,
    el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: t('judges.rotate'),
      onclick: async () => {
        if (!(await confirmAction(t('judges.rotate.confirm', { name: judge.name }), { confirmLabel: t('judges.rotate') }))) return;
        await call(() => api.post(`/api/competitions/${c.id}/judges/${judge.id}/rotate-link`));
      },
    }),
    el('button', {
      class: 'btn btn--sm btn--danger',
      type: 'button',
      text: t('judges.resetScores'),
      onclick: async () => {
        if (!(await confirmAction(t('judges.resetScores.confirm', { name: judge.name }), { confirmLabel: t('judges.resetScores') }))) return;
        await call(() => api.post(`/api/competitions/${c.id}/judges/${judge.id}/reset-scores`));
      },
    }),
    el('button', {
      class: 'btn btn--sm btn--danger',
      type: 'button',
      text: t('action.remove'),
      onclick: async () => {
        if (!(await confirmAction(t('judges.delete.confirm', { name: judge.name })))) return;
        await call(() => api.del(`/api/competitions/${c.id}/judges/${judge.id}`));
      },
    }),
  );

  const pct = progress.total ? (progress.scored / progress.total) * 100 : 0;
  const fill = el('span', { class: 'progress__fill' });
  fill.style.width = `${pct}%`;

  return el(
    'div',
    { class: 'list-item stack' },
    el(
      'div',
      { class: 'row row--between' },
      el(
        'div',
        { class: 'stack stack--tight grow' },
        el('div', { class: 'list-item__title break', text: judge.name }),
        el('div', { class: 'list-item__sub', text: [judge.email, trackLabel].filter(Boolean).join(' · ') }),
      ),
      el('span', { class: badgeClass, text: t(`judges.status.${status}`) }),
    ),
    el('div', { class: 'progress' }, fill),
    el('div', {
      class: 'small muted',
      text: `${t('judges.progress', { scored: progress.scored, total: progress.total })} · ${
        judge.lastSeenAt ? t('judges.lastSeen', { when: fmtDateTime(judge.lastSeenAt) }) : t('judges.neverOpened')
      }`,
    }),
    el('div', { class: 'stack stack--tight' }, el('span', { class: 'label', text: t('judges.link') }), linkRow(judge.link, { label: t('judges.link') })),
    actions,
  );
}

function openJudgeDialog(data, ctx, existing) {
  const nameInput = el('input', { type: 'text', required: true, maxlength: '120', value: existing?.name || '' });
  const emailInput = el('input', { type: 'email', maxlength: '254', value: existing?.email || '' });

  const selectedTracks = new Set(existing?.trackIds || []);
  const trackChecks = data.tracks.map((track) =>
    el(
      'label',
      { class: 'check' },
      el('input', {
        type: 'checkbox',
        checked: selectedTracks.has(track.id),
        onchange: (event) => {
          if (event.target.checked) selectedTracks.add(track.id);
          else selectedTracks.delete(track.id);
        },
      }),
      el('span', { class: 'check__text' }, el('strong', { text: track.name })),
    ),
  );

  openModal({
    title: existing ? t('action.edit') : t('judges.add'),
    submitLabel: existing ? t('action.save') : t('action.add'),
    body: el(
      'div',
      { class: 'stack' },
      field('judges.name', nameInput),
      field('judges.email', emailInput),
      data.tracks.length
        ? el(
            'div',
            { class: 'field' },
            el('label', { text: t('judges.tracks') }),
            el('div', { class: 'stack stack--tight' }, ...trackChecks),
            el('span', { class: 'field__hint', text: t('judges.tracks.help') }),
          )
        : null,
    ),
    onSubmit: async () => {
      const body = { name: nameInput.value, email: emailInput.value, trackIds: [...selectedTracks] };
      if (existing) await api.patch(`/api/competitions/${data.competition.id}/judges/${existing.id}`, body);
      else await api.post(`/api/competitions/${data.competition.id}/judges`, body);
      await ctx.reload();
    },
  });
}

function openBulkDialog(data, ctx) {
  const textarea = el('textarea', { rows: '8' });
  textarea.placeholder = t('judges.bulk.placeholder');
  const resultHost = el('div', {});

  openModal({
    title: t('judges.bulk'),
    submitLabel: t('action.import'),
    body: el(
      'div',
      { class: 'stack' },
      notice(null, el('span', { class: 'small', text: t('judges.bulk.help') })),
      textarea,
      resultHost,
    ),
    onSubmit: async () => {
      const result = await api.post(`/api/competitions/${data.competition.id}/judges/bulk`, { text: textarea.value });
      await ctx.reload();
      if (!result.skipped?.length) return undefined;
      textarea.value = result.skipped.map((s) => s.line).join('\n');
      replace(
        resultHost,
        notice(
          'warn',
          el('span', { class: 'small', text: t('judges.bulk.result', { n: result.created }) }),
          el('span', { class: 'small', text: t('entries.bulk.skipped', { n: result.skipped.length }) }),
        ),
      );
      return { keepOpen: true };
    },
  });
}
