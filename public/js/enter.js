/** Participant submission page, served at /enter/<slug>.
 *
 *  Three states in one page: not signed in, signed in with the window open,
 *  and signed in after the deadline. The last one is read-only rather than
 *  empty, because a participant who comes back wants to see what they entered.
 */
import { api, ApiError } from './api.js';
import { $, el, replace, setBusy } from './dom.js';
import { applyTranslations, fmtDateTime, initI18n, onLocaleChange, t } from './i18n.js';
import { mountLanguagePicker } from './lang.js';
import { confirmAction, field, notice, select, showError } from './admin/shared.js';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const main = $('#main');

let state = null;
let mode = { kind: 'list' };   // list | form (new or editing one entry)

const path = (suffix = '') => `/api/enter/${encodeURIComponent(slug)}${suffix}`;

async function load() {
  state = await api.get(path());
  render();
}

// --- auth ---------------------------------------------------------------

function authCard() {
  const host = el('div');
  let signingUp = false;

  const build = () => {
    const nameInput = el('input', { type: 'text', autocomplete: 'name', maxlength: '120' });
    const emailInput = el('input', { type: 'email', autocomplete: 'email', required: true });
    const passInput = el('input', {
      type: 'password',
      autocomplete: signingUp ? 'new-password' : 'current-password',
      required: true,
    });
    const errorHost = el('div');

    const submit = async (button) => {
      replace(errorHost);
      setBusy(button, true);
      try {
        if (signingUp) {
          await api.post(path('/signup'), {
            name: nameInput.value,
            email: emailInput.value,
            password: passInput.value,
          });
        } else {
          await api.post('/api/auth/login', { email: emailInput.value, password: passInput.value });
        }
        await load();
        return;
      } catch (err) {
        // An organizer or judge account signing in here would land on a page
        // that cannot do anything for them, so say so rather than showing an
        // empty submission list.
        showError(errorHost, err);
      } finally {
        setBusy(button, false);
      }
    };

    const button = el('button', {
      class: 'btn btn--primary',
      type: 'submit',
      text: t(signingUp ? 'enter.signUp' : 'action.signIn'),
    });

    const form = el(
      'form',
      {
        class: 'stack',
        onsubmit: (event) => {
          event.preventDefault();
          void submit(button);
        },
      },
      signingUp && field('enter.yourName', nameInput),
      field('auth.email', emailInput),
      field('auth.password', passInput),
      signingUp && el('p', { class: 'small muted', text: t('auth.password.hint') }),
      errorHost,
      el('div', { class: 'row' }, button),
    );

    replace(
      host,
      el(
        'section',
        { class: 'card stack' },
        el('h2', { text: t(signingUp ? 'enter.createAccount' : 'enter.signInTitle') }),
        el('p', { class: 'small muted', text: t('enter.accountWhy') }),
        form,
        el(
          'p',
          { class: 'small' },
          el('button', {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            text: t(signingUp ? 'enter.haveAccount' : 'enter.needAccount'),
            onclick: () => {
              signingUp = !signingUp;
              build();
            },
          }),
        ),
      ),
    );
  };

  build();
  return host;
}

// --- submission form ----------------------------------------------------

function submissionForm(existing) {
  const nameInput = el('input', { type: 'text', maxlength: '200', required: true, value: existing?.name || '' });
  const teamInput = el('input', { type: 'text', maxlength: '200', value: existing?.teamName || '' });
  const descInput = el('textarea', {
    rows: '4',
    maxlength: String(state.limits.descriptionMaxLength),
    text: existing?.description || '',
  });
  const projectInput = el('input', {
    type: 'url',
    maxlength: String(state.limits.urlMaxLength),
    placeholder: 'https://github.com/...',
    value: existing?.projectUrl || '',
  });
  const videoInput = el('input', {
    type: 'url',
    maxlength: String(state.limits.urlMaxLength),
    placeholder: 'https://...',
    value: existing?.videoUrl || '',
  });

  let trackId = existing?.trackId ?? '';
  const errorHost = el('div');

  const save = async (button) => {
    replace(errorHost);
    setBusy(button, true);
    const body = {
      name: nameInput.value,
      teamName: teamInput.value,
      description: descInput.value,
      projectUrl: projectInput.value,
      videoUrl: videoInput.value,
      trackId,
    };
    try {
      if (existing) await api.patch(path(`/entries/${existing.id}`), body);
      else await api.post(path('/entries'), body);
      mode = { kind: 'list' };
      await load();
    } catch (err) {
      showError(errorHost, err);
    } finally {
      setBusy(button, false);
    }
  };

  const button = el('button', { class: 'btn btn--primary', type: 'submit', text: t('action.save') });

  return el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t(existing ? 'enter.editSubmission' : 'enter.newSubmission') }),
    el(
      'form',
      {
        class: 'stack',
        onsubmit: (event) => {
          event.preventDefault();
          void save(button);
        },
      },
      field('entries.name', nameInput),
      field('enter.teamOptional', teamInput),
      state.tracks.length > 0 &&
        field(
          'entries.track',
          select(
            trackId,
            [{ value: '', label: t('entries.noTrack') }, ...state.tracks.map((tr) => ({ value: tr.id, label: tr.name }))],
            (value) => {
              trackId = value;
            },
          ),
        ),
      field('entries.projectUrl', projectInput, 'enter.projectUrlHint'),
      field('entries.videoUrl', videoInput, 'enter.videoUrlHint'),
      field('entries.description', descInput),
      errorHost,
      el(
        'div',
        { class: 'row' },
        button,
        el('button', {
          class: 'btn',
          type: 'button',
          text: t('action.cancel'),
          onclick: () => {
            mode = { kind: 'list' };
            render();
          },
        }),
      ),
    ),
  );
}

// --- submission list ----------------------------------------------------

function entryCard(entry, open) {
  const errorHost = el('div');

  const remove = async (button) => {
    if (!(await confirmAction(t('enter.confirmWithdraw', { name: entry.name })))) return;
    setBusy(button, true);
    try {
      await api.del(path(`/entries/${entry.id}`));
      await load();
    } catch (err) {
      showError(errorHost, err);
      setBusy(button, false);
    }
  };

  const links = [
    entry.projectUrl &&
      el('a', { href: entry.projectUrl, target: '_blank', rel: 'noopener noreferrer', text: t('entries.projectUrl') }),
    entry.videoUrl &&
      el('a', { href: entry.videoUrl, target: '_blank', rel: 'noopener noreferrer', text: t('entries.videoUrl') }),
  ].filter(Boolean);

  const trackLabel = state.tracks.find((tr) => tr.id === entry.trackId)?.name;

  return el(
    'section',
    { class: 'card stack stack--tight' },
    el(
      'div',
      { class: 'row row--between' },
      el('strong', { text: entry.name }),
      trackLabel && el('span', { class: 'badge badge--soft', text: trackLabel }),
    ),
    entry.teamName && el('p', { class: 'small muted', text: entry.teamName }),
    entry.description && el('p', { class: 'small', text: entry.description }),
    links.length > 0 && el('div', { class: 'row small' }, ...links),
    el('p', { class: 'small muted', text: t('enter.submittedAt', { at: fmtDateTime(entry.createdAt) }) }),
    errorHost,
    open &&
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn btn--sm',
          type: 'button',
          text: t('action.edit'),
          onclick: () => {
            mode = { kind: 'form', entry };
            render();
          },
        }),
        el('button', {
          class: 'btn btn--sm btn--danger',
          type: 'button',
          text: t('enter.withdraw'),
          onclick: (event) => void remove(event.currentTarget),
        }),
      ),
  );
}

function listView() {
  const open = state.competition.submissionsOpen;
  const blocks = [];

  blocks.push(
    open
      ? notice(null, el('span', { class: 'small', text: t('enter.windowOpen') }))
      : notice('warn', el('span', { class: 'small', text: t('enter.windowClosed') })),
  );

  if (state.entries.length === 0) {
    blocks.push(
      el(
        'section',
        { class: 'card stack' },
        el('p', { class: 'muted', text: t(open ? 'enter.noneYet' : 'enter.noneEver') }),
      ),
    );
  } else {
    blocks.push(
      el('p', { class: 'small muted', text: t('enter.countMine', { count: state.entries.length }) }),
      ...state.entries.map((entry) => entryCard(entry, open)),
    );
  }

  if (open) {
    blocks.push(
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          text: t('enter.addSubmission'),
          onclick: () => {
            mode = { kind: 'form', entry: null };
            render();
          },
        }),
      ),
      // Several submissions from one account is a normal hackathon rule, so the
      // page says so rather than leaving a participant guessing.
      el('p', { class: 'small muted', text: t('enter.multipleAllowed') }),
    );
  }

  return blocks;
}

// --- render -------------------------------------------------------------

function render() {
  const who = $('#whoami');
  const signout = $('#signout');
  const signedIn = state?.user && state.user.role === 'participant';
  who.textContent = signedIn ? t('enter.signedInAs', { name: state.user.name }) : '';
  signout.hidden = !signedIn;

  const head = el(
    'div',
    { class: 'stack stack--tight' },
    el('h1', { text: state.competition.name }),
    state.competition.description && el('p', { class: 'muted', text: state.competition.description }),
  );

  if (state.suspended) {
    replace(main, head, notice('warn', el('span', { text: t('error.accountSuspended') })));
    return;
  }
  if (!signedIn) {
    // A signed-in organizer or judge is not a participant here; the auth card
    // lets them sign in with the right account.
    replace(main, head, authCard());
    return;
  }
  if (mode.kind === 'form') {
    replace(main, head, submissionForm(mode.entry));
    return;
  }
  replace(main, head, ...listView().filter(Boolean));
}

// --- boot ---------------------------------------------------------------

$('#signout').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  mode = { kind: 'list' };
  await load();
});

(async () => {
  await initI18n();
  mountLanguagePicker($('#langpick'));
  applyTranslations(document);
  onLocaleChange(() => {
    applyTranslations(document);
    if (state) render();
  });
  try {
    await load();
  } catch (err) {
    replace(
      main,
      notice(
        'warn',
        el('span', {
          text: err instanceof ApiError && err.status === 404 ? t('enter.notFound') : t('state.error'),
        }),
      ),
    );
  }
})();
