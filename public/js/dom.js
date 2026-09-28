/** Tiny DOM helpers. Everything builds real nodes, so no user-supplied
 *  string is ever passed through innerHTML. */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') throw new Error('el(): html is not supported on purpose');
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

export const replace = (node, ...children) => append(clear(node), children);

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Runs fn at most once per `wait` ms of quiet - used for score autosave. */
export function debounce(fn, wait = 500) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.flush = (...args) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn(...args);
    }
  };
  wrapped.pending = () => timer !== null;
  return wrapped;
}

export async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a temporary field so
    // copying still works when the app is served over plain http on a LAN.
    const field = el('textarea', { value, readOnly: true, 'aria-hidden': 'true' });
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    field.remove();
    return ok;
  }
}

/** Briefly swap a button's label to confirm an action. */
export function flashLabel(button, label, ms = 1400) {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, ms);
}

export function setBusy(button, busy, busyLabel) {
  if (busy) {
    button.dataset.label = button.textContent;
    if (busyLabel) button.textContent = busyLabel;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    delete button.dataset.label;
    button.disabled = false;
  }
}
