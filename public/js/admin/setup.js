import { api } from '../api.js';
import { el, replace } from '../dom.js';
import { fmtNumber, t } from '../i18n.js';
import { checkbox, confirmAction, field, linkRow, select, showError } from './shared.js';

export function renderSetupTab(host, data, ctx) {
  const c = data.competition;
  const errorHost = el('div', {});

  // Every switch saves on change; there is no separate Save button to forget
  // about while a demo is running.
  const patch = async (body) => {
    replace(errorHost);
    try {
      await api.patch(`/api/competitions/${c.id}`, body);
      await ctx.reload();
    } catch (err) {
      showError(errorHost, err);
    }
  };

  const nameInput = el('input', { type: 'text', value: c.name, maxlength: '200' });
  const descInput = el('textarea', { maxlength: '4000', value: c.description });
  const saveBasics = el('button', {
    class: 'btn btn--primary',
    type: 'button',
    text: t('action.save'),
    onclick: () => patch({ name: nameInput.value, description: descInput.value }),
  });

  const basics = el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('comp.tab.setup') }),
    field('setup.name', nameInput),
    field('setup.description', descInput),
    el('div', { class: 'row row--end' }, saveBasics),
  );

  const statusCard = el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('comp.status') }),
    el('p', { class: 'card__hint', text: t('comp.status.help') }),
    select(
      c.status,
      [
        { value: 'draft', label: t('dash.status.draft') },
        { value: 'live', label: t('dash.status.live') },
        { value: 'closed', label: t('dash.status.closed') },
      ],
      (value) => patch({ status: value }),
    ),
  );

  const boardCard = el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('comp.boardUrl') }),
    el('p', { class: 'card__hint', text: t('comp.boardUrl.hint') }),
    linkRow(data.boardUrl, { label: t('comp.boardUrl') }),
    el(
      'div',
      { class: 'row' },
      el('a', { class: 'btn btn--sm btn--outline', href: `/board/${c.slug}`, target: '_blank', rel: 'noopener', text: t('results.openBoard') }),
    ),
    checkbox('setup.publicBoard', c.publicBoard, (value) => patch({ publicBoard: value }), 'setup.publicBoard.help'),
    checkbox('setup.showScores', c.showScoresOnBoard, (value) => patch({ showScoresOnBoard: value }), 'setup.showScores.help'),
  );

  const maxPerJudge = data.criteria
    .filter((k) => !k.trackId)
    .reduce((sum, k) => sum + (c.scoringMode === 'weighted' ? k.weight : k.maxScore), 0);

  const scoringCard = el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('setup.scoring') }),
    field(
      'setup.scoringMode',
      select(
        c.scoringMode,
        [
          { value: 'points', label: t('setup.scoringMode.points') },
          { value: 'weighted', label: t('setup.scoringMode.weighted') },
        ],
        (value) => patch({ scoringMode: value }),
      ),
    ),
    field(
      'setup.aggregate',
      select(
        c.aggregate,
        [
          { value: 'avg', label: t('setup.aggregate.avg') },
          { value: 'sum', label: t('setup.aggregate.sum') },
        ],
        (value) => patch({ aggregate: value }),
      ),
    ),
    el('p', { class: 'small faint', text: t('rubric.maxTotal', { n: fmtNumber(maxPerJudge) }) }),
    el('hr'),
    checkbox('setup.dropHighLow', c.dropHighLow, (value) => patch({ dropHighLow: value }), 'setup.dropHighLow.help'),
    checkbox('setup.allowNotes', c.allowNotes, (value) => patch({ allowNotes: value })),
    checkbox('setup.allowDecimals', c.allowDecimals, (value) => patch({ allowDecimals: value }), 'setup.allowDecimals.help'),
  );

  const tracksCard = renderTracks(data, ctx, errorHost);

  const danger = el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('comp.dangerZone') }),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn btn--danger',
        type: 'button',
        text: t('comp.resetScores'),
        onclick: async () => {
          if (!(await confirmAction(t('comp.resetScores.confirm'), { confirmLabel: t('comp.resetScores') }))) return;
          await api.post(`/api/competitions/${c.id}/reset-scores`).catch((err) => showError(errorHost, err));
          await ctx.reload();
        },
      }),
      el('button', {
        class: 'btn btn--danger',
        type: 'button',
        text: t('comp.delete'),
        onclick: async () => {
          if (!(await confirmAction(t('comp.delete.confirm', { name: c.name }), { confirmLabel: t('comp.delete') }))) return;
          try {
            await api.del(`/api/competitions/${c.id}`);
            ctx.goto('/admin');
          } catch (err) {
            showError(errorHost, err);
          }
        },
      }),
    ),
  );

  replace(host, errorHost, basics, statusCard, boardCard, scoringCard, tracksCard, danger);
}

function renderTracks(data, ctx, errorHost) {
  const c = data.competition;
  const newTrack = el('input', { type: 'text', maxlength: '200', placeholder: t('setup.tracks.namePlaceholder') });

  const add = async () => {
    const name = newTrack.value.trim();
    if (!name) return;
    try {
      await api.post(`/api/competitions/${c.id}/tracks`, { name });
      await ctx.reload();
    } catch (err) {
      showError(errorHost, err);
    }
  };

  const items = data.tracks.map((track) => {
    const nameInput = el('input', {
      type: 'text',
      value: track.name,
      maxlength: '200',
      onchange: async (event) => {
        try {
          await api.patch(`/api/competitions/${c.id}/tracks/${track.id}`, { name: event.target.value });
          await ctx.reload();
        } catch (err) {
          showError(errorHost, err);
        }
      },
    });
    const entryCount = data.entries.filter((entry) => entry.trackId === track.id).length;
    const judgeCount = data.judges.filter((judge) => judge.trackIds.includes(track.id)).length;

    return el(
      'div',
      { class: 'list-item' },
      el('div', { class: 'list-item__main stack stack--tight' }, nameInput,
        el('span', { class: 'list-item__sub', text: `${t('dash.card.entries', { n: entryCount })} · ${t('dash.card.judges', { n: judgeCount })}` })),
      el('button', {
        class: 'btn btn--sm btn--danger',
        type: 'button',
        text: t('action.delete'),
        onclick: async () => {
          if (!(await confirmAction(t('setup.tracks.delete.confirm', { name: track.name })))) return;
          try {
            await api.del(`/api/competitions/${c.id}/tracks/${track.id}`);
            await ctx.reload();
          } catch (err) {
            showError(errorHost, err);
          }
        },
      }),
    );
  });

  return el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('setup.tracks') }),
    el('p', { class: 'card__hint', text: t('setup.tracks.help') }),
    items.length ? el('div', { class: 'list' }, ...items) : el('div', { class: 'empty', text: t('setup.tracks.empty') }),
    el(
      'div',
      { class: 'row' },
      el('div', { class: 'grow' }, newTrack),
      el('button', { class: 'btn', type: 'button', text: t('setup.tracks.add'), onclick: add }),
    ),
  );
}

