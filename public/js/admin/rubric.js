import { api } from '../api.js';
import { el, replace } from '../dom.js';
import { fmtNumber, t } from '../i18n.js';
import { confirmAction, field, notice, openModal, select, showError } from './shared.js';

export function renderRubricTab(host, data, ctx) {
  const c = data.competition;
  const errorHost = el('div', {});
  const weighted = c.scoringMode === 'weighted';

  const trackOptions = [
    { value: '', label: t('rubric.track.all') },
    ...data.tracks.map((track) => ({ value: track.id, label: track.name })),
  ];

  const rows = data.criteria.map((criterion) => criterionRow(criterion, data, ctx, errorHost, trackOptions, weighted));

  const weightTotal = data.criteria.filter((k) => !k.trackId).reduce((sum, k) => sum + k.weight, 0);
  const maxTotal = data.criteria
    .filter((k) => !k.trackId)
    .reduce((sum, k) => sum + (weighted ? k.weight : k.maxScore), 0);

  const table = el(
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
          el('th', { text: t('rubric.name') }),
          el('th', { class: 'num', text: t('rubric.max') }),
          el('th', { class: 'num', text: t('rubric.weight') }),
          data.tracks.length > 0 ? el('th', { text: t('rubric.track') }) : null,
          el('th', { text: '' }),
        ),
      ),
      el('tbody', {}, ...rows),
    ),
  );

  const summary = el(
    'div',
    { class: 'row small muted' },
    el('span', { text: t('rubric.maxTotal', { n: fmtNumber(maxTotal) }) }),
    weighted ? el('span', { text: '·' }) : null,
    weighted ? el('span', { text: t('rubric.weightTotal', { n: fmtNumber(weightTotal) }) }) : null,
  );

  const blocks = [
    errorHost,
    el(
      'section',
      { class: 'card stack' },
      el('h2', { text: t('rubric.title') }),
      el('p', { class: 'card__hint', text: t('rubric.help') }),
      data.criteria.length ? table : el('div', { class: 'empty', text: t('rubric.empty') }),
      summary,
      weighted && Math.abs(weightTotal - 100) > 0.01
        ? notice('warn', el('span', { class: 'small', text: t('rubric.weightWarning') }))
        : null,
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          text: t('rubric.add'),
          onclick: () => openCriterionDialog(data, ctx, trackOptions),
        }),
      ),
    ),
    templateCard(data, ctx, errorHost),
  ];

  replace(host, ...blocks.filter(Boolean));
}

function criterionRow(criterion, data, ctx, errorHost, trackOptions, weighted) {
  const c = data.competition;

  const save = async (body) => {
    replace(errorHost);
    try {
      await api.patch(`/api/competitions/${c.id}/criteria/${criterion.id}`, body);
      await ctx.reload();
    } catch (err) {
      showError(errorHost, err);
    }
  };

  const nameInput = el('input', {
    type: 'text',
    value: criterion.name,
    maxlength: '200',
    onchange: (event) => save({ name: event.target.value }),
  });
  const descInput = el('input', {
    type: 'text',
    value: criterion.description,
    maxlength: '4000',
    placeholder: t('rubric.description'),
    onchange: (event) => save({ description: event.target.value }),
  });
  const maxInput = el('input', {
    type: 'number',
    min: '0.01',
    step: '0.5',
    value: String(criterion.maxScore),
    onchange: (event) => save({ maxScore: event.target.value }),
  });
  const weightInput = el('input', {
    type: 'number',
    min: '0',
    step: '1',
    value: String(criterion.weight),
    disabled: !weighted,
    onchange: (event) => save({ weight: event.target.value }),
  });

  return el(
    'tr',
    {},
    el('td', {}, el('div', { class: 'stack stack--tight' }, nameInput, descInput)),
    el('td', { class: 'num' }, maxInput),
    el('td', { class: 'num' }, weightInput),
    data.tracks.length > 0
      ? el(
          'td',
          {},
          select(criterion.trackId || '', trackOptions, (value) => save({ trackId: value || null })),
        )
      : null,
    el(
      'td',
      {},
      el('button', {
        class: 'btn btn--sm btn--danger',
        type: 'button',
        text: t('action.delete'),
        onclick: async () => {
          if (!(await confirmAction(t('rubric.delete.confirm', { name: criterion.name })))) return;
          try {
            await api.del(`/api/competitions/${c.id}/criteria/${criterion.id}`);
            await ctx.reload();
          } catch (err) {
            showError(errorHost, err);
          }
        },
      }),
    ),
  );
}

function openCriterionDialog(data, ctx, trackOptions) {
  const nameInput = el('input', { type: 'text', required: true, maxlength: '200' });
  const descInput = el('textarea', { maxlength: '4000' });
  const maxInput = el('input', { type: 'number', min: '0.01', step: '0.5', value: '10', required: true });
  const weightInput = el('input', { type: 'number', min: '0', step: '1', value: '10' });
  let trackId = '';

  openModal({
    title: t('rubric.add'),
    submitLabel: t('action.add'),
    body: el(
      'div',
      { class: 'stack' },
      field('rubric.name', nameInput),
      field('rubric.description', descInput),
      field('rubric.max', maxInput),
      field('rubric.weight', weightInput),
      data.tracks.length > 0
        ? field(
            'rubric.track',
            select(trackId, trackOptions, (value) => {
              trackId = value;
            }),
          )
        : null,
    ),
    onSubmit: async () => {
      await api.post(`/api/competitions/${data.competition.id}/criteria`, {
        name: nameInput.value,
        description: descInput.value,
        maxScore: maxInput.value,
        weight: weightInput.value,
        trackId: trackId || null,
      });
      await ctx.reload();
    },
  });
}

function templateCard(data, ctx, errorHost) {
  let templateId = 'general';
  let mode = 'append';

  const templates = (ctx.meta?.templates || []).filter((template) => template.criterionCount > 0);
  if (templates.length === 0) return null;

  return el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('rubric.template') }),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'grow' },
        select(
          templateId,
          templates.map((template) => ({
            value: template.id,
            label: `${t(template.labelKey)} (${template.criterionCount})`,
          })),
          (value) => {
            templateId = value;
          },
        ),
      ),
      el(
        'div',
        { class: 'grow' },
        select(
          mode,
          [
            { value: 'append', label: t('rubric.template.append') },
            { value: 'replace', label: t('rubric.template.replace') },
          ],
          (value) => {
            mode = value;
          },
        ),
      ),
      el('button', {
        class: 'btn',
        type: 'button',
        text: t('action.apply'),
        onclick: async () => {
          if (mode === 'replace' && !(await confirmAction(t('rubric.template.replace'), { confirmLabel: t('action.apply') }))) return;
          try {
            await api.post(`/api/competitions/${data.competition.id}/criteria/apply-template`, { template: templateId, mode });
            await ctx.reload();
          } catch (err) {
            showError(errorHost, err);
          }
        },
      }),
    ),
  );
}
