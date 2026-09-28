import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** A message safe and useful to show the user, translated where we can. */
  get userMessage() {
    if (this.code === 'rate_limited') return t('error.rateLimited');
    if (this.code === 'network') return t('error.network');
    if (this.code === 'invalid_credentials') return t('error.invalidCredentials');
    if (this.code === 'unauthorized') return t('error.unauthorized');
    if (this.code === 'account_suspended') return t('error.accountSuspended');
    if (this.status >= 500) return t('error.generic');
    return this.message || t('error.generic');
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (cause) {
    throw new ApiError(0, 'network', t('error.network'), { cause: String(cause) });
  }

  if (res.status === 204) return null;

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const err = payload?.error || {};
    throw new ApiError(res.status, err.code || `http_${res.status}`, err.message || res.statusText, err.details);
  }
  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),
};
