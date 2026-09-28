import { el, replace } from '../dom.js';
import { t } from '../i18n.js';
import { ApiError } from '../api.js';

/** Labelled input, the shape used by every admin form. */
export function field(labelKey, input, hintKey) {
  return el(
    'div',
    { class: 'field' },
    el('label', { text: t(labelKey) }),
    input,
    hintKey && el('span', { class: 'field__hint', text: t(hintKey) }),
  );
}

export function checkbox(labelKey, checked, onChange, hintKey) {
  return el(
    'label',
    { class: 'check' },
    el('input', { type: 'checkbox', checked, onchange: (event) => onChange(event.target.checked) }),
    el(
      'span',
      { class: 'check__text' },
      el('strong', { text: t(labelKey) }),
      hintKey && el('span', { text: t(hintKey) }),
    ),
  );
}

export function select(value, options, onChange, attrs = {}) {
  return el(
    'select',
    { ...attrs, onchange: (event) => onChange(event.target.value) },
    ...options.map((option) => el('option', { value: option.value, text: option.label, selected: option.value === value })),
  );
}

export function notice(kind, ...children) {
  return el(
    'div',
    { class: `notice${kind ? ` notice--${kind}` : ''}` },
    el('span', { class: 'notice__icon', 'aria-hidden': 'true', text: kind === 'danger' ? '!' : kind === 'warn' ? '!' : 'i' }),
    el('div', { class: 'notice__body stack stack--tight' }, ...children),
  );
}

export function showError(host, err) {
  replace(host, notice('danger', el('span', { class: 'small', text: err instanceof ApiError ? err.userMessage : t('error.generic') })));
}

export const clearHost = (host) => replace(host);

/**
 * Promise-based confirmation on a native <dialog>, so destructive admin
 * actions (deleting a competition, rotating a judge link) always need a
 * deliberate second click.
 */
export function confirmAction(message, { confirmLabel = t('action.delete'), danger = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
      dialog.remove();
    };

    const dialog = el(
      'dialog',
      { class: 'modal', onclose: () => finish(false), oncancel: () => finish(false) },
      el(
        'div',
        { class: 'modal__body' },
        el('p', { text: message }),
      ),
      el(
        'div',
        { class: 'modal__foot' },
        el('button', { class: 'btn', type: 'button', text: t('action.cancel'), onclick: () => finish(false) }),
        el('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          type: 'button',
          text: confirmLabel,
          onclick: () => finish(true),
        }),
      ),
    );

    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Modal form host used for "add entry" / "add judge" style dialogs. */
export function openModal({ title, body, submitLabel, onSubmit }) {
  const errorHost = el('div', {});
  const submit = el('button', { class: 'btn btn--primary', type: 'submit', text: submitLabel || t('action.save') });

  const form = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        replace(errorHost);
        submit.disabled = true;
        try {
          // Returning { keepOpen: true } lets a handler report a partial
          // result (e.g. a bulk import with skipped lines) in place.
          const outcome = await onSubmit();
          if (outcome?.keepOpen) {
            submit.disabled = false;
            return;
          }
          dialog.close();
          dialog.remove();
        } catch (err) {
          submit.disabled = false;
          showError(errorHost, err);
        }
      },
    },
    el('div', { class: 'modal__body stack' }, body, errorHost),
    el(
      'div',
      { class: 'modal__foot' },
      el('button', {
        class: 'btn',
        type: 'button',
        text: t('action.cancel'),
        onclick: () => {
          dialog.close();
          dialog.remove();
        },
      }),
      submit,
    ),
  );

  const dialog = el(
    'dialog',
    { class: 'modal', onclose: () => dialog.remove() },
    el('div', { class: 'modal__head' }, el('h2', { text: title })),
    form,
  );

  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('input, select, textarea')?.focus();
  return dialog;
}

/** Copy-to-clipboard row for judge links and the public board URL. */
export function linkRow(value, { label } = {}) {
  const input = el('input', { type: 'text', value, readOnly: true, 'aria-label': label || value, onclick: (e) => e.target.select() });
  const button = el('button', {
    class: 'btn btn--sm',
    type: 'button',
    text: t('action.copy'),
    onclick: async (event) => {
      const { copyToClipboard, flashLabel } = await import('../dom.js');
      const ok = await copyToClipboard(value);
      flashLabel(event.currentTarget, ok ? t('action.copied') : t('state.error'));
    },
  });
  return el('div', { class: 'linkbox' }, input, button);
}

export const statusLabel = (status) => t(`dash.status.${status}`) || status;

export function trackName(competitionData, trackId) {
  if (!trackId) return t('entries.noTrack');
  return competitionData.tracks.find((track) => track.id === trackId)?.name || t('entries.noTrack');
}
