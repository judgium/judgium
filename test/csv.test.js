import test from 'node:test';
import assert from 'node:assert/strict';

import { contentDisposition, csvFilename, toCsv } from '../src/lib/csv.js';

test('CSV output starts with a BOM so Excel reads UTF-8 exports', () => {
  const csv = toCsv(['Entry'], [['プロジェクトA']]);
  assert.equal(csv[0], '﻿');
  assert.ok(csv.includes('プロジェクトA'));
});

test('fields containing commas, quotes or newlines are quoted and escaped', () => {
  const csv = toCsv(['a', 'b', 'c'], [['x,y', 'say "hi"', 'line1\nline2']]);
  const body = csv.slice(1).split('\r\n')[1];
  assert.equal(body, '"x,y","say ""hi""","line1\nline2"');
});

test('leading formula characters are neutralised against CSV injection', () => {
  for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
    const csv = toCsv(['x'], [[dangerous]]);
    const cell = csv.slice(1).split('\r\n')[1];
    assert.ok(cell.startsWith("'"), `${dangerous} should be prefixed, got ${cell}`);
  }
});

test('null and undefined become empty cells rather than the words', () => {
  const csv = toCsv(['a', 'b'], [[null, undefined]]);
  assert.equal(csv.slice(1).split('\r\n')[1], ',');
});

test('filenames keep CJK characters and drop everything unsafe', () => {
  const name = csvFilename('春のハッカソン/2026 <test>', 'leaderboard');
  assert.ok(name.includes('春のハッカソン'), name);
  assert.ok(!/[/<>]/.test(name), name);
  assert.ok(name.endsWith('.csv'));
});

test('Content-Disposition carries both an ASCII fallback and the UTF-8 name', () => {
  const header = contentDisposition('春のハッカソン-leaderboard.csv');
  assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.ok(header.includes(encodeURIComponent('春のハッカソン-leaderboard.csv')));
});

test('a filename with no usable characters still produces something', () => {
  assert.match(csvFilename('///', 'leaderboard'), /^export-leaderboard-/);
});
