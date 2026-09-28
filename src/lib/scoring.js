import { round2 } from './validate.js';

/**
 * Reads every row needed to score a competition in a handful of queries.
 * Entry and judge counts are unbounded by design, so everything here is
 * keyed lookups over one pass - no per-entry queries.
 */
export function loadBundle(db, competitionId) {
  const competition = db
    .prepare('SELECT * FROM competitions WHERE id = ?')
    .get(competitionId);
  if (!competition) return null;

  const tracks = db
    .prepare('SELECT * FROM tracks WHERE competition_id = ? ORDER BY sort_order, created_at')
    .all(competitionId);
  const criteria = db
    .prepare('SELECT * FROM criteria WHERE competition_id = ? ORDER BY sort_order, created_at')
    .all(competitionId);
  const entries = db
    .prepare('SELECT * FROM entries WHERE competition_id = ? ORDER BY sort_order, created_at')
    .all(competitionId);
  const judges = db
    .prepare('SELECT * FROM judges WHERE competition_id = ? ORDER BY sort_order, created_at')
    .all(competitionId);
  const judgeTrackRows = db
    .prepare(
      `SELECT jt.judge_id, jt.track_id
         FROM judge_tracks jt
         JOIN judges j ON j.id = jt.judge_id
        WHERE j.competition_id = ?`,
    )
    .all(competitionId);

  const judgeTracks = new Map();
  for (const row of judgeTrackRows) {
    if (!judgeTracks.has(row.judge_id)) judgeTracks.set(row.judge_id, new Set());
    judgeTracks.get(row.judge_id).add(row.track_id);
  }

  return { competition, tracks, criteria, entries, judges, judgeTracks };
}

export function loadScoreRows(db, competitionId) {
  return db
    .prepare(
      `SELECT s.entry_id, s.judge_id, s.criterion_id, s.value
         FROM scores s
         JOIN entries e ON e.id = s.entry_id
        WHERE e.competition_id = ?`,
    )
    .all(competitionId);
}

/** Criteria that apply to a given track (track_id NULL = applies to all). */
export function criteriaForTrack(criteria, trackId) {
  const scoped = criteria.filter((c) => c.track_id && c.track_id === trackId);
  const global = criteria.filter((c) => !c.track_id);
  // Track-specific criteria replace nothing; they add to the shared rubric.
  return [...global, ...scoped].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

/** True when a judge is allowed to score entries in this track. */
export function judgeCoversTrack(judgeTracks, judgeId, trackId) {
  const set = judgeTracks.get(judgeId);
  if (!set || set.size === 0) return true; // unrestricted judge
  if (!trackId) return true; // untracked entry is visible to everyone
  return set.has(trackId);
}

/** Maximum attainable total for one entry, given the competition's mode. */
export function maxTotalFor(competition, applicableCriteria) {
  if (competition.scoring_mode === 'weighted') {
    return applicableCriteria.reduce((sum, c) => sum + (c.weight || 0), 0);
  }
  return applicableCriteria.reduce((sum, c) => sum + (c.max_score || 0), 0);
}

/**
 * One judge's total for one entry.
 *
 * Criteria the judge has not filled in yet count as zero, so the leaderboard
 * moves as judges type rather than only when they finish. `filled` is returned
 * alongside so callers can show how complete a score actually is.
 */
export function judgeTotalFor(competition, applicableCriteria, valuesByCriterion) {
  let total = 0;
  let filled = 0;
  for (const c of applicableCriteria) {
    const raw = valuesByCriterion.get(c.id);
    if (raw === undefined) continue;
    filled++;
    const max = c.max_score || 0;
    const clamped = Math.min(Math.max(raw, 0), max || raw);
    if (competition.scoring_mode === 'weighted') {
      total += max > 0 ? (clamped / max) * (c.weight || 0) : 0;
    } else {
      total += clamped;
    }
  }
  return { total, filled };
}

/**
 * Combine per-judge totals into the entry's score.
 * Drop high/low removes one maximum and one minimum, and only kicks in once
 * three judges have scored the entry - otherwise it would erase the panel.
 */
export function combineJudgeTotals(competition, totals) {
  if (totals.length === 0) return { score: null, used: [], droppedHigh: null, droppedLow: null };

  let used = [...totals].sort((a, b) => a - b);
  let droppedHigh = null;
  let droppedLow = null;

  if (competition.drop_high_low && used.length >= 3) {
    droppedLow = used.shift();
    droppedHigh = used.pop();
  }

  const sum = used.reduce((a, b) => a + b, 0);
  const score = competition.aggregate === 'sum' ? sum : sum / used.length;
  return { score, used, droppedHigh, droppedLow };
}

/**
 * Full leaderboard + per-judge matrix for a competition.
 *
 * Cost is O(entries x criteria + scores); with 500 entries, 15 judges and 6
 * criteria that is ~45k operations, comfortably inside one throttle window.
 */
export function computeResults(db, competitionId, bundle = null) {
  const data = bundle || loadBundle(db, competitionId);
  if (!data) return null;
  const { competition, tracks, criteria, entries, judges, judgeTracks } = data;
  const scoreRows = loadScoreRows(db, competitionId);

  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const judgeById = new Map(judges.map((j) => [j.id, j]));

  // entryId -> judgeId -> Map(criterionId -> value)
  const byEntry = new Map();
  for (const row of scoreRows) {
    if (!judgeById.has(row.judge_id)) continue;
    let perJudge = byEntry.get(row.entry_id);
    if (!perJudge) {
      perJudge = new Map();
      byEntry.set(row.entry_id, perJudge);
    }
    let values = perJudge.get(row.judge_id);
    if (!values) {
      values = new Map();
      perJudge.set(row.judge_id, values);
    }
    values.set(row.criterion_id, row.value);
  }

  const criteriaCache = new Map();
  const applicableFor = (trackId) => {
    const key = trackId || '';
    if (!criteriaCache.has(key)) criteriaCache.set(key, criteriaForTrack(criteria, trackId));
    return criteriaCache.get(key);
  };

  let expectedCells = 0;
  let filledCells = 0;

  const rows = entries.map((entry) => {
    const applicable = applicableFor(entry.track_id);
    const maxTotal = maxTotalFor(competition, applicable);
    const perJudge = byEntry.get(entry.id) || new Map();

    const eligibleJudges = judges.filter((j) => judgeCoversTrack(judgeTracks, j.id, entry.track_id));
    expectedCells += eligibleJudges.length * applicable.length;

    const judgeScores = [];
    const criterionSums = new Map();
    const criterionCounts = new Map();

    for (const judge of eligibleJudges) {
      const values = perJudge.get(judge.id);
      if (!values || values.size === 0) continue;
      const { total, filled } = judgeTotalFor(competition, applicable, values);
      filledCells += filled;
      judgeScores.push({
        judgeId: judge.id,
        judgeName: judge.name,
        total: round2(total),
        filled,
        complete: filled === applicable.length,
        values: Object.fromEntries(applicable.map((c) => [c.id, values.has(c.id) ? values.get(c.id) : null])),
      });
      for (const c of applicable) {
        if (!values.has(c.id)) continue;
        criterionSums.set(c.id, (criterionSums.get(c.id) || 0) + values.get(c.id));
        criterionCounts.set(c.id, (criterionCounts.get(c.id) || 0) + 1);
      }
    }

    const combined = combineJudgeTotals(
      competition,
      judgeScores.map((j) => j.total),
    );

    return {
      id: entry.id,
      name: entry.name,
      teamName: entry.team_name,
      trackId: entry.track_id,
      trackName: entry.track_id ? trackById.get(entry.track_id)?.name || '' : '',
      tableLabel: entry.table_label,
      projectUrl: entry.project_url,
      videoUrl: entry.video_url,
      score: combined.score === null ? null : round2(combined.score),
      maxScore: round2(competition.aggregate === 'sum' ? maxTotal * Math.max(1, combined.used.length) : maxTotal),
      judgesScored: judgeScores.length,
      judgesEligible: eligibleJudges.length,
      judgesComplete: judgeScores.filter((j) => j.complete).length,
      droppedHigh: combined.droppedHigh === null ? null : round2(combined.droppedHigh),
      droppedLow: combined.droppedLow === null ? null : round2(combined.droppedLow),
      criterionAverages: Object.fromEntries(
        applicable.map((c) => {
          const count = criterionCounts.get(c.id) || 0;
          return [c.id, count ? round2(criterionSums.get(c.id) / count) : null];
        }),
      ),
      judgeScores,
    };
  });

  rankRows(rows);

  const judgesCompleted = judges.filter((j) => j.completed_at).length;

  return {
    competition,
    tracks,
    criteria,
    judges: judges.map((j) => ({
      id: j.id,
      name: j.name,
      email: j.email,
      completedAt: j.completed_at,
      lastSeenAt: j.last_seen_at,
      trackIds: [...(judgeTracks.get(j.id) || [])],
    })),
    rows,
    stats: {
      entryCount: entries.length,
      judgeCount: judges.length,
      judgesCompleted,
      criterionCount: criteria.length,
      expectedCells,
      filledCells,
      progress: expectedCells > 0 ? round2((filledCells / expectedCells) * 100) : 0,
      topScore: rows.reduce((m, r) => (r.score !== null && r.score > m ? r.score : m), 0),
    },
    rev: competition.rev,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Sorts rows into leaderboard order and assigns ranks in place.
 * Unscored entries keep rank null and sink to the bottom, matching how the
 * demo-room board should read before the first judge submits.
 */
export function rankRows(rows) {
  rows.sort((a, b) => {
    const aHas = a.score !== null;
    const bHas = b.score !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && b.score !== a.score) return b.score - a.score;
    if (b.judgesScored !== a.judgesScored) return b.judgesScored - a.judgesScored;
    return a.name.localeCompare(b.name);
  });

  let rank = 0;
  let lastScore = null;
  let seen = 0;
  for (const row of rows) {
    if (row.score === null) {
      row.rank = null;
      continue;
    }
    seen++;
    if (lastScore === null || row.score !== lastScore) {
      rank = seen;
      lastScore = row.score;
    }
    row.rank = rank;
  }
  return rows;
}

/** Public leaderboard shape - never leaks judge identities or notes. */
export function toPublicBoard(results) {
  const showScores = !!results.competition.show_scores_on_board;
  return {
    competition: {
      id: results.competition.id,
      name: results.competition.name,
      description: results.competition.description,
      status: results.competition.status,
      slug: results.competition.public_slug,
      showScores,
      dropHighLow: !!results.competition.drop_high_low,
      scoringMode: results.competition.scoring_mode,
      aggregate: results.competition.aggregate,
    },
    tracks: results.tracks.map((t) => ({ id: t.id, name: t.name })),
    rows: results.rows.map((r) => ({
      id: r.id,
      rank: r.rank,
      name: r.name,
      teamName: r.teamName,
      trackId: r.trackId,
      trackName: r.trackName,
      score: showScores ? r.score : null,
      maxScore: showScores ? r.maxScore : null,
      scored: r.score !== null,
      judgesScored: r.judgesScored,
      judgesEligible: r.judgesEligible,
    })),
    stats: {
      entryCount: results.stats.entryCount,
      judgeCount: results.stats.judgeCount,
      judgesCompleted: results.stats.judgesCompleted,
      progress: results.stats.progress,
      topScore: showScores ? results.stats.topScore : null,
    },
    rev: results.rev,
    computedAt: results.computedAt,
  };
}
