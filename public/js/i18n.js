/** Locale loading and string interpolation.
 *
 *  Strings live in /i18n/<locale>.json and are fetched once per page. English
 *  is always loaded as the fallback so a missing key degrades to English
 *  rather than to the raw key.
 */

export const LOCALES = ['en', 'ja', 'es', 'zh', 'ko'];
export const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'judgium.locale';

let current = DEFAULT_LOCALE;
let strings = {};
let fallback = {};
const listeners = new Set();

function normalize(tag) {
  if (!tag) return null;
  const lower = String(tag).toLowerCase();
  if (LOCALES.includes(lower)) return lower;
  const base = lower.split('-')[0];
  if (LOCALES.includes(base)) return base;
  // Map the common regional tags onto the five shipped locales.
  if (base === 'zh') return 'zh';
  if (base === 'ja') return 'ja';
  if (base === 'ko') return 'ko';
  if (base === 'es') return 'es';
  return null;
}

/** Stored choice wins, then ?lang=, then the browser, then English. */
export function detectLocale(preferred) {
  const url = new URLSearchParams(location.search).get('lang');
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  for (const candidate of [normalize(url), normalize(stored), normalize(preferred), ...(navigator.languages || [navigator.language]).map(normalize)]) {
    if (candidate) return candidate;
  }
  return DEFAULT_LOCALE;
}

async function fetchLocale(locale) {
  const res = await fetch(`/i18n/${locale}.json`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Could not load locale ${locale}`);
  return res.json();
}

export async function initI18n(preferred) {
  fallback = await fetchLocale(DEFAULT_LOCALE);
  const locale = detectLocale(preferred);
  await setLocale(locale, { persist: false });
  return current;
}

export async function setLocale(locale, { persist = true } = {}) {
  const next = normalize(locale) || DEFAULT_LOCALE;
  strings = next === DEFAULT_LOCALE ? fallback : await fetchLocale(next);
  current = next;
  document.documentElement.lang = next === 'zh' ? 'zh-Hans' : next;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private browsing - the choice just will not stick */
    }
  }
  applyTranslations();
  for (const fn of listeners) {
    try {
      fn(next);
    } catch (err) {
      console.error('[i18n] locale listener failed', err);
    }
  }
  return next;
}

export const getLocale = () => current;
export const onLocaleChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const PLACEHOLDER = /\{(\w+)\}/g;

export function t(key, params) {
  const template = strings[key] ?? fallback[key];
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Applies translations to static markup:
 *   data-i18n="key"             -> textContent
 *   data-i18n-placeholder="key" -> placeholder
 *   data-i18n-title="key"       -> title
 *   data-i18n-label="key"       -> aria-label
 */
export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  for (const node of root.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
  const title = root === document ? document.querySelector('title[data-i18n]') : null;
  if (title) document.title = t(title.dataset.i18n);
}

/** Locale-aware number and date formatting for scores and timestamps. */
export const fmtNumber = (value, options) =>
  value === null || value === undefined ? '–' : new Intl.NumberFormat(localeTag(), options).format(value);

export const fmtDateTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

function localeTag() {
  return { en: 'en', ja: 'ja-JP', es: 'es-ES', zh: 'zh-Hans', ko: 'ko-KR' }[current] || 'en';
}
