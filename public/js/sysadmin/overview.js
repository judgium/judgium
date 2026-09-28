import { api } from '../api.js';
import { el, replace, setBusy } from '../dom.js';
import { fmtDateTime, fmtNumber, t } from '../i18n.js';
import { notice, showError } from '../admin/shared.js';

function statTile(labelKey, value, hint) {
  return el(
    'div',
    { class: 'stat' },
    el('span', { class: 'stat__label', text: t(labelKey) }),
    el('span', { class: 'stat__value tabnum', text: fmtNumber(value) }),
    hint && el('span', { class: 'stat__hint', text: hint }),
  );
}

const kb = (bytes) => `${fmtNumber(Math.round(bytes / 1024))} KB`;
const infoRow = (label, value) => el('tr', {}, el('th', { text: label }), el('td', {}, value));

function storageCard(storage) {
  const backupResult = el('div', {});

  const backupButton = el('button', {
    class: 'btn btn--sm',
    type: 'button',
    text: t('sys.storage.backupNow'),
    onclick: async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, t('state.saving'));
      try {
        const result = await api.post('/api/sysadmin/backup');
        replace(
          backupResult,
          notice(
            '',
            el('span', { class: 'small', text: t('sys.storage.backupDone', { size: kb(result.backup.bytes) }) }),
            el('span', { class: 'mono small break', text: result.backup.path }),
          ),
        );
      } catch (err) {
        showError(backupResult, err);
      } finally {
        setBusy(button, false);
      }
    },
  });

  return el(
    'div',
    { class: 'card stack' },
    el('h2', { text: t('sys.storage.title') }),
    el('p', { class: 'small muted', text: t('sys.storage.body') }),
    // Persistence is the question an operator actually has, so say outright
    // whether a restart is survivable rather than leaving it to be discovered.
    storage.sessionsSurviveRestart
      ? null
      : notice('warn', el('span', { class: 'small', text: t('sys.storage.ephemeralWarning') })),
    el(
      'div',
      { class: 'table-scroll' },
      el(
        'table',
        { class: 'data' },
        el(
          'tbody',
          {},
          infoRow(t('sys.storage.dbPath'), el('span', { class: 'mono small break', text: storage.dbPath })),
          infoRow(t('sys.storage.dbSize'), kb(storage.dbBytes)),
          infoRow(t('sys.storage.schema'), storage.schemaVersion || t('sys.storage.schemaBaseline')),
          infoRow(
            t('sys.storage.sessionKey'),
            el('span', {
              class: `badge ${storage.sessionsSurviveRestart ? 'badge--soft' : 'badge--warn'}`,
              text: t(`sys.storage.sessionKey.${storage.sessionSecretSource}`),
            }),
          ),
          infoRow(t('sys.storage.backupDir'), el('span', { class: 'mono small break', text: storage.backupDir })),
        ),
      ),
    ),
    el('div', { class: 'row' }, backupButton),
    backupResult,
  );
}

function recentCard(titleKey, emptyKey, allTab, ctx, rows) {
  return el(
    'div',
    { class: 'card stack' },
    el(
      'div',
      { class: 'row row--between' },
      el('h2', { text: t(titleKey) }),
      el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        text: t('sys.recent.all'),
        onclick: () => ctx.goto(`/sysadmin/${allTab}`),
      }),
    ),
    rows.length === 0 ? el('div', { class: 'empty', text: t(emptyKey) }) : el('div', { class: 'list' }, ...rows),
  );
}

export async function renderOverviewTab(host, ctx) {
  const data = await api.get('/api/sysadmin/overview');

  const tiles = el(
    'div',
    { class: 'stat-grid' },
    statTile('sys.stat.users', data.users.total, t('sys.stat.users.hint', { n: data.users.everSignedIn })),
    statTile('sys.stat.superadmins', data.users.superadmins),
    statTile('sys.stat.suspended', data.users.suspended),
    statTile(
      'sys.stat.competitions',
      data.competitions.total,
      t('sys.stat.competitions.hint', { n: data.competitions.live }),
    ),
    statTile('sys.stat.entries', data.content.entries),
    statTile('sys.stat.judges', data.content.judges),
    statTile('sys.stat.scores', data.content.scores),
    statTile('sys.stat.liveViewers', data.live.clients, t('sys.stat.liveViewers.hint', { n: data.live.maxClients })),
  );

  const users = recentCard(
    'sys.recent.users',
    'sys.users.empty',
    'users',
    ctx,
    data.recentUsers.map((user) =>
      el(
        'div',
        { class: 'list-item' },
        el(
          'div',
          { class: 'list-item__main' },
          el('div', { class: 'list-item__title', text: user.name }),
          el('div', { class: 'list-item__sub', text: user.email }),
        ),
        el('span', {
          class: `badge ${user.role === 'superadmin' ? '' : 'badge--muted'}`,
          text: t(`sys.role.${user.role}`),
        }),
        el('span', { class: 'small faint nowrap', text: fmtDateTime(user.createdAt) }),
      ),
    ),
  );

  const competitions = recentCard(
    'sys.recent.competitions',
    'sys.competitions.empty',
    'competitions',
    ctx,
    data.recentCompetitions.map((competition) =>
      el(
        'div',
        { class: 'list-item' },
        el(
          'div',
          { class: 'list-item__main' },
          el('div', { class: 'list-item__title', text: competition.name }),
          el('div', { class: 'list-item__sub', text: competition.ownerEmail || t('sys.competitions.noOwner') }),
        ),
        el('span', {
          class: `badge ${competition.status === 'live' ? '' : 'badge--muted'}`,
          text: t(`dash.status.${competition.status}`),
        }),
        el('span', { class: 'small faint nowrap', text: fmtDateTime(competition.updatedAt) }),
      ),
    ),
  );

  replace(host, tiles, storageCard(data.storage), el('div', { class: 'grid-2' }, users, competitions));
}
