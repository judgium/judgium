import { api, ApiError } from './api.js';
import { $, el, replace, setBusy } from './dom.js';
import { applyTranslations, initI18n, onLocaleChange, t } from './i18n.js';
import { mountLanguagePicker } from './lang.js';

const main = $('#main');
const navHost = $('#nav');

let meta = { signupEnabled: true };
let user = null;
let view = location.pathname === '/signup' ? 'signup' : location.pathname === '/login' ? 'login' : 'home';

// --- views -------------------------------------------------------------

function render() {
  renderNav();
  if (view === 'login' || view === 'signup') renderAuth();
  else renderHome();
  applyTranslations(main);
}

function renderNav() {
  if (user) {
    replace(
      navHost,
      el('a', { class: 'btn btn--sm btn--primary', href: '/admin', text: t('nav.dashboard') }),
    );
    return;
  }
  replace(
    navHost,
    el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: t('action.signIn'),
      onclick: () => navigate('login'),
    }),
    meta.signupEnabled
      ? el('button', {
          class: 'btn btn--sm btn--primary',
          type: 'button',
          text: t('action.signUp'),
          onclick: () => navigate('signup'),
        })
      : null,
  );
}

function navigate(next) {
  view = next;
  const path = next === 'home' ? '/' : `/${next}`;
  history.pushState({ view: next }, '', path);
  render();
  window.scrollTo({ top: 0 });
}

function renderHome() {
  const hero = el(
    'section',
    { class: 'hero stack' },
    el('h1', { text: t('home.hero.title') }),
    el('p', { class: 'hero__tagline', text: t('app.tagline') }),
    el('p', { class: 'hero__lead', text: t('app.description') }),
    el('p', { text: t('home.hero.body') }),
    el(
      'div',
      { class: 'row' },
      user
        ? el('a', { class: 'btn btn--primary', href: '/admin', text: t('nav.dashboard') })
        : el('button', {
            class: 'btn btn--primary',
            type: 'button',
            text: t('home.hero.cta'),
            onclick: () => navigate(meta.signupEnabled ? 'signup' : 'login'),
          }),
      !user && el('button', { class: 'btn', type: 'button', text: t('action.signIn'), onclick: () => navigate('login') }),
    ),
    el('p', { class: 'small faint', text: t('auth.judgeHint') }),
  );

  const steps = el(
    'section',
    { class: 'card stack' },
    el('h2', { text: t('home.how.title') }),
    el('p', { class: 'muted small', text: t('home.how.body') }),
    el(
      'div',
      { class: 'grid-2' },
      ...[1, 2, 3, 4, 5, 6].map((n) =>
        el(
          'div',
          { class: 'step' },
          el('span', { class: 'step__num', text: String(n) }),
          el(
            'div',
            { class: 'step__body' },
            el('h3', { text: t(`home.how.${n}.title`) }),
            el('p', { text: t(`home.how.${n}.body`) }),
          ),
        ),
      ),
    ),
  );

  const featureKeys = ['criteria', 'links', 'board', 'drop', 'devices', 'export'];
  const features = el(
    'section',
    { class: 'stack' },
    el('h2', { text: t('home.features.title') }),
    el(
      'div',
      { class: 'grid-3' },
      ...featureKeys.map((key) =>
        el(
          'div',
          { class: 'card stack stack--tight' },
          el('h3', { text: t(`home.features.${key}.title`) }),
          el('p', { class: 'small muted', text: t(`home.features.${key}.body`) }),
        ),
      ),
    ),
  );

  replace(main, hero, steps, features);
}

function renderAuth() {
  const isSignup = view === 'signup';
  if (isSignup && !meta.signupEnabled) {
    replace(
      main,
      el(
        'section',
        { class: 'card stack' },
        el('h1', { text: t('auth.signUp.title') }),
        el('p', { class: 'muted', text: t('auth.signupDisabled') }),
        el('button', { class: 'btn', type: 'button', text: t('action.signIn'), onclick: () => navigate('login') }),
      ),
    );
    return;
  }

  const errorHost = el('div', {});
  const nameInput = isSignup ? el('input', { type: 'text', name: 'name', autocomplete: 'name', required: true }) : null;
  const emailInput = el('input', { type: 'email', name: 'email', autocomplete: 'email', required: true });
  const passwordInput = el('input', {
    type: 'password',
    name: 'password',
    autocomplete: isSignup ? 'new-password' : 'current-password',
    required: true,
    minlength: isSignup ? '10' : '1',
  });

  const submit = el('button', {
    class: 'btn btn--primary btn--block',
    type: 'submit',
    text: isSignup ? t('action.signUp') : t('action.signIn'),
  });

  const form = el(
    'form',
    {
      class: 'stack',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        replace(errorHost);
        setBusy(submit, true, t('state.loading'));
        try {
          const body = { email: emailInput.value, password: passwordInput.value };
          if (isSignup) {
            body.name = nameInput.value;
            body.locale = document.documentElement.lang.split('-')[0];
            await api.post('/api/auth/signup', body);
          } else {
            await api.post('/api/auth/login', body);
          }
          location.assign('/admin');
        } catch (err) {
          setBusy(submit, false);
          replace(
            errorHost,
            el('div', { class: 'notice notice--danger' },
              el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: '!' }),
              el('div', { class: 'notice__body small', text: err instanceof ApiError ? err.userMessage : t('error.generic') }),
            ),
          );
        }
      },
    },
    isSignup && el('div', { class: 'field' }, el('label', { for: 'f-name', text: t('auth.name') }), Object.assign(nameInput, { id: 'f-name' })),
    el('div', { class: 'field' }, el('label', { for: 'f-email', text: t('auth.email') }), Object.assign(emailInput, { id: 'f-email' })),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'f-pass', text: t('auth.password') }),
      Object.assign(passwordInput, { id: 'f-pass' }),
      isSignup && el('span', { class: 'field__hint', text: t('auth.password.hint') }),
    ),
    errorHost,
    submit,
  );

  replace(
    main,
    el(
      'section',
      { class: 'card stack' },
      el('h1', { text: isSignup ? t('auth.signUp.title') : t('auth.signIn.title') }),
      form,
      el('hr'),
      el(
        'p',
        { class: 'small muted' },
        isSignup ? t('auth.haveAccount') : t('auth.noAccount'),
        ' ',
        meta.signupEnabled || isSignup
          ? el('button', {
              class: 'btn btn--sm btn--ghost',
              type: 'button',
              text: isSignup ? t('action.signIn') : t('action.signUp'),
              onclick: () => navigate(isSignup ? 'login' : 'signup'),
            })
          : null,
      ),
      el('p', { class: 'small faint', text: t('auth.judgeHint') }),
    ),
  );
  main.classList.add('shell--narrow');
  (nameInput || emailInput).focus();
}

// --- boot --------------------------------------------------------------

async function boot() {
  const [session, metaPayload] = await Promise.all([
    api.get('/api/auth/me').catch(() => ({ user: null, signupEnabled: true })),
    api.get('/api/meta').catch(() => ({ signupEnabled: true })),
  ]);
  user = session.user;
  meta = { signupEnabled: metaPayload.signupEnabled !== false };

  await initI18n(user?.locale);
  mountLanguagePicker($('#langpick'));
  onLocaleChange(() => render());

  window.addEventListener('popstate', () => {
    view = location.pathname === '/signup' ? 'signup' : location.pathname === '/login' ? 'login' : 'home';
    main.classList.toggle('shell--narrow', view !== 'home');
    render();
  });

  main.classList.toggle('shell--narrow', view !== 'home');
  render();
}

void boot();
