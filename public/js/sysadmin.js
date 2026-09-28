/** Platform administration shell.
 *
 *  Deliberately a separate page from /admin: that one is scoped to the signed-in
 *  organizer's own competitions, this one spans every account on the
 *  deployment. Keeping them apart means a superadmin cannot mistake one context
 *  for the other while looking at somebody else's data.
 */
import { api, ApiError } from './api.js';
import { $, el, replace, setBusy } from './dom.js';
import { applyTranslations, initI18n, onLocaleChange, t } from './i18n.js';
import { mountLanguagePicker } from './lang.js';
import { renderOverviewTab } from './sysadmin/overview.js';
import { renderUsersTab } from './sysadmin/users.js';
import { renderCompetitionsTab } from './sysadmin/competitions.js';
import { renderAuditTab } from './sysadmin/audit.js';

const main = $('#main');
const TABS = ['overview', 'users', 'competitions', 'audit'];

export const store = { user: null };

const renderers = {
  overview: renderOverviewTab,
  users: renderUsersTab,
  competitions: renderCompetitionsTab,
  audit: renderAuditTab,
};

function parseRoute() {
  const parts = location.pathname.split('/').filter(Boolean); // ['sysadmin', tab?]
  return TABS.includes(parts[1]) ? parts[1] : 'overview';
}

export function goto(path, { replaceEntry = false } = {}) {
  if (replaceEntry) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  void route();
}

async function route() {
  const tab = parseRoute();

  const header = el(
    'div',
    { class: 'stack stack--tight' },
    el('h1', { text: t('sys.title') }),
    el('p', { class: 'muted', text: t('sys.subtitle') }),
  );

  const tabBar = el(
    'nav',
    { class: 'tabs', role: 'tablist' },
    ...TABS.map((name) =>
      el('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        'aria-selected': name === tab ? 'true' : 'false',
        text: t(`sys.tab.${name}`),
        onclick: () => goto(`/sysadmin/${name}`),
      }),
    ),
  );

  const panel = el('div', { class: 'stack stack--loose', role: 'tabpanel' });
  replace(main, el('div', { class: 'stack' }, header, tabBar, panel));
  applyTranslations(main);

  replace(panel, el('p', { class: 'muted', text: t('state.loading') }));
  try {
    await renderers[tab](panel, { goto, reload: () => route(), me: store.user });
  } catch (err) {
    replace(
      panel,
      el(
        'div',
        { class: 'notice notice--danger' },
        el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '!' }),
        el('div', { class: 'notice__body small', text: err instanceof ApiError ? err.userMessage : t('error.generic') }),
      ),
    );
  }
  applyTranslations(panel);
  window.scrollTo({ top: 0 });
}

async function boot() {
  let session;
  try {
    session = await api.get('/api/auth/me');
  } catch {
    session = { user: null };
  }
  if (!session.user) {
    location.replace('/login');
    return;
  }
  // The API refuses every /api/sysadmin call for a non-superadmin anyway; this
  // just avoids showing them a shell full of permission errors.
  if (session.user.role !== 'superadmin') {
    location.replace('/admin');
    return;
  }
  store.user = session.user;

  await initI18n(session.user.locale);
  mountLanguagePicker($('#langpick'), {
    onChange: (locale) => {
      void api.patch('/api/auth/me', { locale }).catch(() => {});
    },
  });

  const whoami = $('#whoami');
  const setWhoami = () => {
    if (whoami) whoami.textContent = t('nav.signedInAs', { name: store.user.name });
  };
  setWhoami();

  $('#signout')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    await api.post('/api/auth/logout').catch(() => {});
    location.assign('/');
  });

  onLocaleChange(() => {
    setWhoami();
    void route();
  });

  window.addEventListener('popstate', () => void route());
  await route();
}

void boot();
