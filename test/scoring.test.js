import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineJudgeTotals,
  criteriaForTrack,
  judgeCoversTrack,
  judgeTotalFor,
  maxTotalFor,
  rankRows,
} from '../src/lib/scoring.js';

const points = { scoring_mode: 'points', aggregate: 'avg', drop_high_low: 0 };
const weighted = { scoring_mode: 'weighted', aggregate: 'avg', drop_high_low: 0 };

const criterion = (id, maxScore, weight, trackId = null, order = 0) => ({
  id,
  max_score: maxScore,
  weight,
  track_id: trackId,
  sort_order: order,
  created_at: '2026-01-01T00:00:00.000Z',
});

test('points mode sums raw criterion scores', () => {
  const criteria = [criterion('a', 10, 50), criterion('b', 15, 50)];
  const values = new Map([
    ['a', 10],
    ['b', 8],
  ]);
  assert.deepEqual(judgeTotalFor(points, criteria, values), { total: 18, filled: 2 });
  assert.equal(maxTotalFor(points, criteria), 25);
});

test('weighted mode scales each criterion by its weight out of the weight total', () => {
  const criteria = [criterion('a', 10, 25), criterion('b', 20, 75)];
  const values = new Map([
    ['a', 10], // full marks on the 25% criterion
    ['b', 10], // half marks on the 75% criterion
  ]);
  const { total } = judgeTotalFor(weighted, criteria, values);
  assert.equal(total, 25 + 37.5);
  assert.equal(maxTotalFor(weighted, criteria), 100);
});

test('unfilled criteria count as zero so the board moves while judges type', () => {
  const criteria = [criterion('a', 10, 50), criterion('b', 10, 50)];
  const { total, filled } = judgeTotalFor(points, criteria, new Map([['a', 7]]));
  assert.equal(total, 7);
  assert.equal(filled, 1, 'filled reports partial progress separately from the total');
});

test('scores above a criterion maximum are clamped', () => {
  const criteria = [criterion('a', 10, 100)];
  assert.equal(judgeTotalFor(points, criteria, new Map([['a', 99]])).total, 10);
});

test('averaging judges is the default', () => {
  const result = combineJudgeTotals(points, [10, 20, 30]);
  assert.equal(result.score, 20);
  assert.equal(result.droppedHigh, null);
  assert.equal(result.droppedLow, null);
});

test('summing judges is available for point-pool style events', () => {
  assert.equal(combineJudgeTotals({ ...points, aggregate: 'sum' }, [10, 20, 30]).score, 60);
});

test('drop high/low removes one extreme at each end', () => {
  const result = combineJudgeTotals({ ...points, drop_high_low: 1 }, [9, 40, 60]);
  assert.equal(result.score, 40);
  assert.equal(result.droppedLow, 9);
  assert.equal(result.droppedHigh, 60);
});

test('drop high/low is skipped below three judges so it cannot erase a panel', () => {
  const two = combineJudgeTotals({ ...points, drop_high_low: 1 }, [10, 30]);
  assert.equal(two.score, 20);
  assert.equal(two.droppedHigh, null);

  const one = combineJudgeTotals({ ...points, drop_high_low: 1 }, [42]);
  assert.equal(one.score, 42);
});

test('an entry nobody has scored has a null score', () => {
  assert.equal(combineJudgeTotals(points, []).score, null);
});

test('track criteria are added to the shared rubric, in sort order', () => {
  const criteria = [
    criterion('shared-2', 10, 10, null, 1),
    criterion('shared-1', 10, 10, null, 0),
    criterion('ai-only', 10, 10, 't_ai', 2),
    criterion('fin-only', 10, 10, 't_fin', 3),
  ];
  assert.deepEqual(
    criteriaForTrack(criteria, 't_ai').map((c) => c.id),
    ['shared-1', 'shared-2', 'ai-only'],
  );
  assert.deepEqual(
    criteriaForTrack(criteria, null).map((c) => c.id),
    ['shared-1', 'shared-2'],
    'an entry with no track only gets the shared criteria',
  );
});

test('a judge with no track assignment covers every track', () => {
  const judgeTracks = new Map([['j_sponsor', new Set(['t_ai'])]]);
  assert.equal(judgeCoversTrack(judgeTracks, 'j_general', 't_fin'), true);
  assert.equal(judgeCoversTrack(judgeTracks, 'j_sponsor', 't_ai'), true);
  assert.equal(judgeCoversTrack(judgeTracks, 'j_sponsor', 't_fin'), false);
  assert.equal(judgeCoversTrack(judgeTracks, 'j_sponsor', null), true, 'untracked entries stay visible to everyone');
});

test('ranking ties share a rank and unscored entries sink to the bottom', () => {
  const rows = [
    { id: '1', name: 'Alpha', score: 50, judgesScored: 2 },
    { id: '2', name: 'Bravo', score: 80, judgesScored: 2 },
    { id: '3', name: 'Charlie', score: null, judgesScored: 0 },
    { id: '4', name: 'Delta', score: 80, judgesScored: 2 },
  ];
  rankRows(rows);
  assert.deepEqual(
    rows.map((r) => [r.name, r.rank]),
    [
      ['Bravo', 1],
      ['Delta', 1],
      ['Alpha', 3],
      ['Charlie', null],
    ],
  );
});

test('equal scores break the tie by judge coverage, then name', () => {
  const rows = [
    { id: '1', name: 'Zeta', score: 10, judgesScored: 1 },
    { id: '2', name: 'Alpha', score: 10, judgesScored: 1 },
    { id: '3', name: 'Middle', score: 10, judgesScored: 3 },
  ];
  rankRows(rows);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Middle', 'Alpha', 'Zeta'],
  );
});
