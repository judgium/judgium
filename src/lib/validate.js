import { config } from '../config.js';
import { badRequest } from './errors.js';

export function str(value, field, { required = false, max = config.limits.nameMaxLength, trim = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest('missing_field', `${field} is required`, { field });
    return '';
  }
  if (typeof value !== 'string') throw badRequest('invalid_type', `${field} must be a string`, { field });
  const out = trim ? value.trim() : value;
  if (required && out === '') throw badRequest('missing_field', `${field} is required`, { field });
  if (out.length > max) throw badRequest('too_long', `${field} must be at most ${max} characters`, { field, max });
  return out;
}

export function num(value, field, { min = -Infinity, max = Infinity, required = false, integer = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest('missing_field', `${field} is required`, { field });
    return null;
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw badRequest('invalid_number', `${field} must be a number`, { field });
  if (integer && !Number.isInteger(n)) throw badRequest('invalid_number', `${field} must be a whole number`, { field });
  if (n < min || n > max) throw badRequest('out_of_range', `${field} must be between ${min} and ${max}`, { field, min, max });
  return n;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function oneOf(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest('missing_field', `${field} is required`, { field });
  }
  if (!allowed.includes(value)) {
    throw badRequest('invalid_value', `${field} must be one of: ${allowed.join(', ')}`, { field, allowed });
  }
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function email(value, field = 'email', { required = true } = {}) {
  const s = str(value, field, { required, max: 254 }).toLowerCase();
  if (!s) return '';
  if (!EMAIL_RE.test(s)) throw badRequest('invalid_email', `${field} is not a valid e-mail address`, { field });
  return s;
}

export function optionalUrl(value, field) {
  const s = str(value, field, { max: config.limits.urlMaxLength });
  if (!s) return '';
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    throw badRequest('invalid_url', `${field} is not a valid URL`, { field });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('invalid_url', `${field} must be an http(s) URL`, { field });
  }
  return parsed.toString();
}

/** Round to at most 2 decimals so 7.5 stays 7.5 but 0.1+0.2 does not drift. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
