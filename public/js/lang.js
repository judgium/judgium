import { LOCALES, getLocale, setLocale, t } from './i18n.js';
import { el } from './dom.js';

/**
 * The language toggle that sits at the top right of every page.
 * `onChange` lets a page persist the choice server-side (judges do).
 */
export function mountLanguagePicker(container, { onChange } = {}) {
  const select = el(
    'select',
    {
      'aria-label': t('lang.switch'),
      onchange: async (event) => {
        const next = event.target.value;
        await setLocale(next);
        onChange?.(next);
      },
    },
    ...LOCALES.map((code) => el('option', { value: code, text: t(`lang.${code}`), selected: code === getLocale() })),
  );

  const wrapper = el('div', { class: 'langpick' }, select);
  container.replaceChildren(wrapper);

  return {
    sync() {
      select.value = getLocale();
      select.setAttribute('aria-label', t('lang.switch'));
      for (const option of select.options) option.textContent = t(`lang.${option.value}`);
    },
  };
}
