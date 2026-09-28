import { api } from '../api.js';
import { debounce, el, replace, setBusy } from '../dom.js';
import { fmtDateTime, fmtNumber, t } from '../i18n.js';
import { confirmAction, field, openModal, select, showError } from '../admin/shared.js';

const PAGE_SIZE = 25;

const roleOptions = () => [
  { value: 'organizer', label: t('sys.role.organizer') },
  { value: 'superadmin', label: t('sys.role.superadmin') },
];

function roleBadge(user) {
  return el('span', {
    class: `badge ${user.role === 'superadmin' ? '' : 'badge--muted'}`,
    text: t(`sys.role.${user.role}`),
  });
}

function statusBadge(user) {
  return el('span', {
    class: `badge ${user.status === 'suspended' ? 'badge--danger' : 'badge--soft'}`,
    text: t(`sys.status.${user.status}`),
  });
}

/**
 * One row's action menu.
 *
 * `me` drives the disabled states for the self-lockout cases. They are only a
 * courtesy - the API rejects them too, and it is the API that is authoritative.
 * `refresh` reloads just this table so the active search and page survive.
 */
function rowActions(user, { me, refresh }) {
  const isSelf = user.id === me.id;
  const errorHost = el('div', {});

  const act = (label, handler, { danger = false, disabled = false, title } = {}) =>
    el('button', {
      class: `btn btn--sm ${danger ? 'btn--danger' : ''}`,
      type: 'button',
      text: label,
      disabled,
      title: title || null,
      onclick: async (event) => {
        const button = event.currentTarget;
        setBusy(button, true, t('state.saving'));
        try {
          await handler();
          await refresh();
        } catch (err) {
          setBusy(button, false);
          showError(errorHost, err);
        }
      },
    });

  const selfNote = isSelf ? t('sys.users.selfDisabled') : undefined;

  return el(
    'div',
    { class: 'stack stack--tight' },
    el(
      'div',
      { class: 'row' },
      act(
        user.role === 'superadmin' ? t('sys.users.demote') : t('sys.users.promote'),
        () =>
          api.patch(`/api/sysadmin/users/${encodeURIComponent(user.id)}`, {
            role: user.role === 'superadmin' ? 'organizer' : 'superadmin',
          }),
        { disabled: isSelf, title: selfNote },
      ),
      act(
        user.status === 'suspended' ? t('sys.users.reinstate') : t('sys.users.suspend'),
        () =>
          api.patch(`/api/sysadmin/users/${encodeURIComponent(user.id)}`, {
            status: user.status === 'suspended' ? 'active' : 'suspended',
          }),
        { disabled: isSelf, danger: user.status !== 'suspended', title: selfNote },
      ),
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        text: t('sys.users.resetPassword'),
        onclick: () => openPasswordDialog(user),
      }),
      act(
        t('action.delete'),
        async () => {
          const ok = await confirmAction(t('sys.users.confirmDelete', { email: user.email, n: user.counts.competitions }), {
            confirmLabel: t('action.delete'),
          });
          if (!ok) return;
          await api.del(`/api/sysadmin/users/${encodeURIComponent(user.id)}`);
        },
        { danger: true, disabled: isSelf, title: selfNote },
      ),
    ),
    errorHost,
  );
}

function openPasswordDialog(user) {
  const input = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' });
  openModal({
    title: t('sys.users.resetPassword'),
    submitLabel: t('action.save'),
    body: el(
      'div',
      { class: 'stack' },
      el('p', { class: 'small muted', text: t('sys.users.resetPasswordBody', { email: user.email }) }),
      field('auth.password', input, 'auth.password.hint'),
    ),
    onSubmit: async () => {
      await api.post(`/api/sysadmin/users/${encodeURIComponent(user.id)}/password`, { newPassword: input.value });
    },
  });
}

function openCreateDialog(refresh) {
  const nameInput = el('input', { type: 'text', required: true, maxlength: '120' });
  const emailInput = el('input', { type: 'email', required: true, autocomplete: 'off' });
  const passwordInput = el('input', { type: 'password', required: true, minlength: '10', autocomplete: 'new-password' });
  let role = 'organizer';

  openModal({
    title: t('sys.users.create'),
    submitLabel: t('action.create'),
    body: el(
      'div',
      { class: 'stack' },
      el('p', { class: 'small muted', text: t('sys.users.createBody') }),
      field('auth.name', nameInput),
      field('auth.email', emailInput),
      field('auth.password', passwordInput, 'auth.password.hint'),
      field('sys.users.role', select(role, roleOptions(), (value) => {
        role = value;
      })),
    ),
    onSubmit: async () => {
      await api.post('/api/sysadmin/users', {
        name: nameInput.value,
        email: emailInput.value,
        password: passwordInput.value,
        role,
      });
      await refresh();
    },
  });
}

export async function renderUsersTab(host, ctx) {
  // Filter state lives here rather than in the URL: it is a transient lookup,
  // and keeping it out of history means Back leaves the tab, not the filter.
  const filters = { q: '', role: '', status: '', offset: 0 };

  const tableHost = el('div', { class: 'stack' });

  const searchInput = el('input', {
    type: 'search',
    'aria-label': t('sys.users.search'),
    oninput: debounce((event) => {
      filters.q = event.target.value.trim();
      filters.offset = 0;
      void load();
    }, 300),
  });
  searchInput.placeholder = t('sys.users.search');

  const controls = el(
    'div',
    { class: 'row row--between' },
    el(
      'div',
      { class: 'row grow' },
      searchInput,
      select('', [{ value: '', label: t('sys.users.allRoles') }, ...roleOptions()], (value) => {
        filters.role = value;
        filters.offset = 0;
        void load();
      }),
      select(
        '',
        [
          { value: '', label: t('sys.users.allStatuses') },
          { value: 'active', label: t('sys.status.active') },
          { value: 'suspended', label: t('sys.status.suspended') },
        ],
        (value) => {
          filters.status = value;
          filters.offset = 0;
          void load();
        },
      ),
    ),
    el('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: t('sys.users.create'),
      // `load` is a hoisted function declaration below, so the closure resolves.
      onclick: () => openCreateDialog(load),
    }),
  );

  async function load() {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(filters.offset) });
    if (filters.q) params.set('q', filters.q);
    if (filters.role) params.set('role', filters.role);
    if (filters.status) params.set('status', filters.status);

    let data;
    try {
      data = await api.get(`/api/sysadmin/users?${params}`);
    } catch (err) {
      return showError(tableHost, err);
    }

    if (data.users.length === 0) {
      return replace(tableHost, el('div', { class: 'empty', text: t('sys.users.empty') }));
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
          el('th', { text: t('sys.users.col.account') }),
          el('th', { text: t('sys.users.col.role') }),
          el('th', { class: 'num', text: t('sys.users.col.competitions') }),
          el('th', { text: t('sys.users.col.lastLogin') }),
          el('th', { text: t('sys.users.col.actions') }),
        ),
      ),
      el(
        'tbody',
        {},
        ...data.users.map((user) =>
          el(
            'tr',
            {},
            el(
              'td',
              {},
              el(
                'div',
                { class: 'stack stack--tight' },
                el('strong', { class: 'break', text: user.name }),
                el('span', { class: 'small muted break', text: user.email }),
                user.id === ctx.me.id ? el('span', { class: 'badge badge--soft', text: t('sys.users.you') }) : null,
              ),
            ),
            el('td', {}, el('div', { class: 'row row--nowrap' }, roleBadge(user), statusBadge(user))),
            el(
              'td',
              { class: 'num' },
              el('div', { class: 'stack stack--tight' },
                el('span', { text: fmtNumber(user.counts.competitions) }),
                el('span', { class: 'small faint', text: t('sys.users.contentCounts', { entries: user.counts.entries, judges: user.counts.judges }) }),
              ),
            ),
            el('td', { class: 'small' }, user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : t('sys.users.never')),
            el('td', {}, rowActions(user, { me: ctx.me, refresh: load })),
          ),
        ),
      ),
    );

    const shown = `${filters.offset + 1}-${filters.offset + data.users.length}`;
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
          disabled: filters.offset + data.users.length >= data.total,
          onclick: () => {
            filters.offset += PAGE_SIZE;
            void load();
          },
        }),
      ),
    );

    replace(tableHost, el('div', { class: 'card card--flush' }, el('div', { class: 'table-scroll' }, table)), pager);
  }

  replace(host, el('div', { class: 'stack stack--loose' }, controls, tableHost));
  await load();
}
