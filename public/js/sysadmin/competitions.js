import { api } from '../api.js';
import { debounce, el, replace, setBusy } from '../dom.js';
import { fmtDateTime, fmtNumber, t } from '../i18n.js';
import { confirmAction, select, showError } from '../admin/shared.js';

const PAGE_SIZE = 25;

const STATUSES = ['draft', 'live', 'closed'];

export async function renderCompetitionsTab(host, ctx) {
  const filters = { q: '', status: '', offset: 0 };
  const tableHost = el('div', { class: 'stack' });

  const searchInput = el('input', {
    type: 'search',
    'aria-label': t('sys.competitions.search'),
    oninput: debounce((event) => {
      filters.q = event.target.value.trim();
      filters.offset = 0;
      void load();
    }, 300),
  });
  searchInput.placeholder = t('sys.competitions.search');

  const controls = el(
    'div',
    { class: 'row' },
    searchInput,
    select(
      '',
      [
        { value: '', label: t('sys.competitions.allStatuses') },
        ...STATUSES.map((status) => ({ value: status, label: t(`dash.status.${status}`) })),
      ],
      (value) => {
        filters.status = value;
        filters.offset = 0;
        void load();
      },
    ),
  );

  function actions(competition) {
    const errorHost = el('div', {});

    const run = (label, handler, { danger = false } = {}) =>
      el('button', {
        class: `btn btn--sm ${danger ? 'btn--danger' : ''}`,
        type: 'button',
        text: label,
        onclick: async (event) => {
          const button = event.currentTarget;
          setBusy(button, true, t('state.saving'));
          try {
            const proceed = await handler();
            if (proceed === false) return setBusy(button, false);
            await load();
          } catch (err) {
            setBusy(button, false);
            showError(errorHost, err);
          }
        },
      });

    return el(
      'div',
      { class: 'stack stack--tight' },
      el(
        'div',
        { class: 'row' },
        el('a', {
          class: 'btn btn--sm btn--ghost',
          href: `/board/${competition.slug}`,
          target: '_blank',
          rel: 'noopener',
          text: t('sys.competitions.openBoard'),
        }),
        competition.status === 'closed'
          ? run(t('sys.competitions.reopen'), () =>
              api.patch(`/api/sysadmin/competitions/${encodeURIComponent(competition.id)}`, { status: 'live' }),
            )
          : run(t('sys.competitions.close'), () =>
              api.patch(`/api/sysadmin/competitions/${encodeURIComponent(competition.id)}`, { status: 'closed' }),
            ),
        run(
          t('action.delete'),
          async () => {
            const ok = await confirmAction(
              t('sys.competitions.confirmDelete', { name: competition.name, owner: competition.ownerEmail }),
              { confirmLabel: t('action.delete') },
            );
            if (!ok) return false;
            await api.del(`/api/sysadmin/competitions/${encodeURIComponent(competition.id)}`);
            return true;
          },
          { danger: true },
        ),
      ),
      errorHost,
    );
  }

  async function load() {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(filters.offset) });
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);

    let data;
    try {
      data = await api.get(`/api/sysadmin/competitions?${params}`);
    } catch (err) {
      return showError(tableHost, err);
    }

    if (data.competitions.length === 0) {
      return replace(tableHost, el('div', { class: 'empty', text: t('sys.competitions.empty') }));
    }

    const table = el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: t('sys.competitions.col.competition') }),
          el('th', { text: t('sys.competitions.col.owner') }),
          el('th', { class: 'num', text: t('sys.competitions.col.size') }),
          el('th', { text: t('sys.competitions.col.updated') }),
          el('th', { text: t('sys.users.col.actions') }),
        ),
      ),
      el(
        'tbody',
        {},
        ...data.competitions.map((competition) =>
          el(
            'tr',
            {},
            el(
              'td',
              {},
              el(
                'div',
                { class: 'stack stack--tight' },
                el('strong', { class: 'break', text: competition.name }),
                el(
                  'div',
                  { class: 'row row--nowrap' },
                  el('span', {
                    class: `badge ${competition.status === 'live' ? '' : 'badge--muted'}`,
                    text: t(`dash.status.${competition.status}`),
                  }),
                  el('span', { class: 'mono small faint break', text: competition.slug }),
                ),
              ),
            ),
            el(
              'td',
              { class: 'small' },
              competition.ownerEmail
                ? el(
                    'div',
                    { class: 'stack stack--tight' },
                    el('span', { class: 'break', text: competition.ownerName }),
                    el('span', { class: 'muted break', text: competition.ownerEmail }),
                  )
                : el('span', { class: 'faint', text: t('sys.competitions.noOwner') }),
            ),
            el(
              'td',
              { class: 'num small' },
              el(
                'div',
                { class: 'stack stack--tight' },
                el('span', { text: t('dash.card.entries', { n: competition.counts.entries }) }),
                el('span', { class: 'muted', text: t('dash.card.judges', { n: competition.counts.judges }) }),
                el('span', { class: 'faint', text: t('sys.competitions.scores', { n: fmtNumber(competition.counts.scores) }) }),
              ),
            ),
            el('td', { class: 'small' }, fmtDateTime(competition.updatedAt)),
            el('td', {}, actions(competition)),
          ),
        ),
      ),
    );

    const shown = `${filters.offset + 1}-${filters.offset + data.competitions.length}`;
    const pager = el(
      'div',
      { class: 'row row--between' },
      el('span', { class: 'small muted', text: t('sys.pager.showing', { shown, total: data.total }) }),
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          text: t('action.previous'),
          disabled: filters.offset === 0,
          onclick: () => {
            filters.offset = Math.max(0, filters.offset - PAGE_SIZE);
            void load();
          },
        }),
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          text: t('action.next'),
          disabled: filters.offset + data.competitions.length >= data.total,
          onclick: () => {
            filters.offset += PAGE_SIZE;
            void load();
          },
        }),
      ),
    );

    replace(tableHost, el('div', { class: 'card card--flush' }, el('div', { class: 'table-scroll' }, table)), pager);
  }

  replace(
    host,
    el(
      'div',
      { class: 'stack stack--loose' },
      el('p', { class: 'small muted', text: t('sys.competitions.body') }),
      controls,
      tableHost,
    ),
  );
  await load();
}
