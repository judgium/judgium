import { api } from '../api.js';
import { el, replace } from '../dom.js';
import { fmtDateTime, t } from '../i18n.js';
import { showError } from '../admin/shared.js';

const PAGE_SIZE = 50;

/** Human label for an action, falling back to the raw key for new actions. */
const actionLabel = (action) => {
  const label = t(`sys.audit.action.${action}`);
  return label === `sys.audit.action.${action}` ? action : label;
};

export async function renderAuditTab(host) {
  const state = { offset: 0 };
  const tableHost = el('div', { class: 'stack' });

  async function load() {
    let data;
    try {
      data = await api.get(`/api/sysadmin/audit?limit=${PAGE_SIZE}&offset=${state.offset}`);
    } catch (err) {
      return showError(tableHost, err);
    }

    if (data.events.length === 0) {
      return replace(tableHost, el('div', { class: 'empty', text: t('sys.audit.empty') }));
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
          el('th', { text: t('sys.audit.col.when') }),
          el('th', { text: t('sys.audit.col.actor') }),
          el('th', { text: t('sys.audit.col.action') }),
          el('th', { text: t('sys.audit.col.target') }),
          el('th', { text: t('sys.audit.col.detail') }),
        ),
      ),
      el(
        'tbody',
        {},
        ...data.events.map((event) =>
          el(
            'tr',
            {},
            el('td', { class: 'small nowrap' }, fmtDateTime(event.createdAt)),
            el(
              'td',
              { class: 'small' },
              el(
                'div',
                { class: 'stack stack--tight' },
                // The actor's e-mail is stored on the row, so it still reads
                // correctly after the account itself has been deleted.
                el('span', { class: 'break', text: event.actorEmail || t('sys.audit.unknownActor') }),
                event.ip && el('span', { class: 'mono faint break', text: event.ip }),
              ),
            ),
            el('td', {}, el('span', { class: 'badge badge--soft', text: actionLabel(event.action) })),
            el(
              'td',
              { class: 'small' },
              el(
                'div',
                { class: 'stack stack--tight' },
                el('span', { class: 'break', text: event.targetLabel || event.targetId || '—' }),
                event.targetType && el('span', { class: 'faint', text: event.targetType }),
              ),
            ),
            el('td', { class: 'small muted break' }, event.detail || '—'),
          ),
        ),
      ),
    );

    const shown = `${state.offset + 1}-${state.offset + data.events.length}`;
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
          disabled: state.offset === 0,
          onclick: () => {
            state.offset = Math.max(0, state.offset - PAGE_SIZE);
            void load();
          },
        }),
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          text: t('action.next'),
          disabled: state.offset + data.events.length >= data.total,
          onclick: () => {
            state.offset += PAGE_SIZE;
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
      el('p', { class: 'small muted', text: t('sys.audit.body') }),
      tableHost,
    ),
  );
  await load();
}
