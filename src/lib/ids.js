import crypto from 'node:crypto';

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/1/i/l/o - safe to read aloud

/** Opaque primary key. */
export function newId(prefix = '') {
  return prefix + crypto.randomBytes(16).toString('hex');
}

/** URL-safe random string from an unambiguous alphabet. */
export function randomCode(length = 10) {
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    const v = bytes[i];
    // Reject the tail of the byte range so every symbol stays equally likely.
    if (v >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[v % ALPHABET.length];
  }
  return out.length === length ? out : out + randomCode(length - out.length);
}

/** Judge links are bearer credentials, so give them real entropy. */
export function newJudgeToken() {
  return randomCode(24);
}

// Keep CJK/Hangul characters - they carry meaning in a slug for these locales.
const SLUG_KEEP = /[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function slugify(input, fallback = 'event') {
  const base = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(SLUG_KEEP, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return (base || fallback) + '-' + randomCode(6);
}
