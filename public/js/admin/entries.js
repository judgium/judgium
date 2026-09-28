import { api } from '../api.js';
import { el, replace } from '../dom.js';
import { t } from '../i18n.js';
import { confirmAction, field, notice, openModal, select, showError, trackName } from './shared.js';

export function renderEntriesTab(host, data, ctx) {
  const c = data.competition;
  const errorHost = el('div', {});

  const trackOptions = [
    { value: '', label: t('entries.noTrack') },
    ...data.tracks.map((track) => ({ value: track.id, label: track.name })),
  ];

  const filterOptions = [
    { value: 'all', label: t('results.filter.all') },
    ...data.tracks.map((track) => ({ value: track.id, label: track.name })),
    ...(data.tracks.length ? [{ value: 'none', label: t('entries.noTrack') }] : []),
  ];
  let filter = 'all';

  const listHost = el('div', { class: 'stack' });

  const drawList = () => {
    const visible = data.entries.filter((entry) => {
      if (filter === 'all') return true;
      if (filter === 'none') return !entry.trackId;
      return entry.trackId === filter;
    });

    if (visible.length === 0) {
      replace(listHost, el('div', { class: 'empty', text: t('entries.empty') }));
      return;
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
              el('th', { text: '#' }),
              el('th', { text: t('entries.name') }),
              el('th', { text: t('entries.team') }),
              data.tracks.length ? el('th', { text: t('entries.track') }) : null,
              el('th', { text: t('entries.table') }),
              el('th', { text: '' }),
            ),
          ),
          el(
            'tbody',
            {},
            ...visible.map((entry, position) =>
              el(
                'tr',
                {},
                el('td', { class: 'faint tabnum', text: String(position + 1) }),
                el('td', {}, el('span', { class: 'break', text: entry.name })),
                el('td', {}, el('span', { class: 'break muted small', text: entry.teamName || '—' })),
                data.tracks.length ? el('td', { class: 'small muted', text: trackName(data, entry.trackId) }) : null,
                el('td', { class: 'small muted', text: entry.tableLabel || '—' }),
                el(
                  'td',
                  {},
                  el(
                    'div',
                    { class: 'row row--nowrap' },
                    el('button', {
                      class: 'btn btn--sm',
                      type: 'button',
                      text: t('action.edit'),
                      onclick: () => openEntryDialog(data, ctx, trackOptions, entry),
                    }),
                    el('button', {
                      class: 'btn btn--sm btn--danger',
                      type: 'button',
                      text: t('action.delete'),
                      onclick: async () => {
                        if (!(await confirmAction(t('entries.delete.confirm', { name: entry.name })))) return;
                        try {
                          await api.del(`/api/competitions/${c.id}/entries/${entry.id}`);
                          await ctx.reload();
                        } catch (err) {
                          showError(errorHost, err);
                        }
                      },
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  };

  const head = el(
    'div',
    { class: 'card__head' },
    el(
      'div',
      { class: 'stack stack--tight' },
      el('h2', { text: t('entries.title') }),
      el('p', { class: 'card__hint', text: t('entries.help') }),
    ),
    el('span', { class: 'badge badge--soft', text: t('entries.count', { n: data.entries.length }) }),
  );

  const controls = el(
    'div',
    { class: 'row row--between' },
    data.tracks.length
      ? el(
          'div',
          {},
          select(filter, filterOptions, (value) => {
            filter = value;
            drawList();
          }),
        )
      : el('span', {}),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn btn--primary',
        type: 'button',
        text: t('entries.add'),
        onclick: () => openEntryDialog(data, ctx, trackOptions, null),
      }),
      el('button', {
        class: 'btn',
        type: 'button',
        text: t('entries.bulk'),
        onclick: () => openBulkDialog(data, ctx),
      }),
    ),
  );

  drawList();
  replace(host, errorHost, el('section', { class: 'card stack' }, head, controls, listHost));
}

function openEntryDialog(data, ctx, trackOptions, existing) {
  const nameInput = el('input', { type: 'text', required: true, maxlength: '200', value: existing?.name || '' });
  const teamInput = el('input', { type: 'text', maxlength: '200', value: existing?.teamName || '' });
  const descInput = el('textarea', { maxlength: '4000', value: existing?.description || '' });
  const tableInput = el('input', { type: 'text', maxlength: '40', value: existing?.tableLabel || '' });
  const projectInput = el('input', { type: 'url', maxlength: '500', value: existing?.projectUrl || '' });
  const videoInput = el('input', { type: 'url', maxlength: '500', value: existing?.videoUrl || '' });
  let trackId = existing?.trackId || '';

  openModal({
    title: existing ? t('action.edit') : t('entries.add'),
    submitLabel: existing ? t('action.save') : t('action.add'),
    body: el(
      'div',
      { class: 'stack' },
      field('entries.name', nameInput),
      field('entries.team', teamInput),
      trackOptions.length > 1
        ? field(
            'entries.track',
            select(trackId, trackOptions, (value) => {
              trackId = value;
            }),
          )
        : null,
      field('entries.table', tableInput),
      field('entries.projectUrl', projectInput),
      field('entries.videoUrl', videoInput),
      field('entries.description', descInput),
    ),
    onSubmit: async () => {
      const body = {
        name: nameInput.value,
        teamName: teamInput.value,
        description: descInput.value,
        tableLabel: tableInput.value,
        projectUrl: projectInput.value,
        videoUrl: videoInput.value,
        trackId: trackId || null,
      };
      if (existing) await api.patch(`/api/competitions/${data.competition.id}/entries/${existing.id}`, body);
      else await api.post(`/api/competitions/${data.competition.id}/entries`, body);
      await ctx.reload();
    },
  });
}

function openBulkDialog(data, ctx) {
  const textarea = el('textarea', { rows: '10' });
  textarea.placeholder = t('entries.bulk.placeholder');
  const resultHost = el('div', {});

  openModal({
    title: t('entries.bulk'),
    submitLabel: t('action.import'),
    body: el(
      'div',
      { class: 'stack' },
      notice(null, el('span', { class: 'small', text: t('entries.bulk.help') })),
      textarea,
      resultHost,
    ),
    onSubmit: async () => {
      const result = await api.post(`/api/competitions/${data.competition.id}/entries/bulk`, { text: textarea.value });
      await ctx.reload();
      if (!result.skipped?.length) return undefined;
      // Report which lines could not be parsed instead of closing silently.
      textarea.value = result.skipped.map((s) => s.line).join('\n');
      replace(
        resultHost,
        notice(
          'warn',
          el('span', { class: 'small', text: t('entries.bulk.result', { n: result.created }) }),
          el('span', { class: 'small', text: t('entries.bulk.skipped', { n: result.skipped.length }) }),
        ),
      );
      return { keepOpen: true };
    },
  });
}
