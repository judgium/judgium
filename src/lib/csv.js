const NEEDS_QUOTES = /[",\r\n]/;
// A leading =, +, - or @ makes spreadsheets treat the cell as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  // UTF-8 BOM so Excel opens Japanese/Korean/Chinese exports correctly.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function csvFilename(base, suffix) {
  const safe = String(base || 'export')
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'export';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${safe}-${suffix}-${stamp}.csv`;
}

/** RFC 5987 filename so non-ASCII competition names survive the header. */
export function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** rank, entry, score, plus one column per criterion average. */
export function leaderboardCsv(results) {
  const criteria = results.criteria;
  const headers = [
    'Rank',
    'Entry',
    'Team',
    'Track',
    'Score',
    'Max score',
    'Judges scored',
    'Judges eligible',
    'Dropped high',
    'Dropped low',
    ...criteria.map((c) => `${c.name} (avg /${c.max_score})`),
  ];
  const rows = results.rows.map((r) => [
    r.rank ?? '',
    r.name,
    r.teamName,
    r.trackName,
    r.score ?? '',
    r.maxScore ?? '',
    r.judgesScored,
    r.judgesEligible,
    r.droppedHigh ?? '',
    r.droppedLow ?? '',
    ...criteria.map((c) => {
      const v = r.criterionAverages[c.id];
      return v === undefined || v === null ? '' : v;
    }),
  ]);
  return toCsv(headers, rows);
}

/** One row per judge x entry, with every criterion as a column, plus notes. */
/**
 * The entry roster as submitted, rather than as ranked.
 *
 * leaderboardCsv answers "who won"; this answers "what was entered" - the
 * description and the two links a judge actually reads when reviewing
 * asynchronously, plus who submitted it. Rows are in the organizer's own entry
 * order so the file matches the Entries tab, with rank as a column rather than
 * the sort key.
 *
 * `extras` maps entry id -> { description, submitter, sortOrder }; the
 * leaderboard result does not carry those, and is deliberately not made to.
 */
export function entriesCsv(results, extras = new Map()) {
  const headers = [
    'Entry',
    'Team',
    'Track',
    'Table',
    'Submitted by',
    'Project URL',
    'Demo video URL',
    'Description',
    'Rank',
    'Score',
    'Max score',
    'Judges scored',
    'Judges eligible',
  ];
  const ordered = [...results.rows].sort(
    (a, b) => (extras.get(a.id)?.sortOrder ?? 0) - (extras.get(b.id)?.sortOrder ?? 0),
  );
  const rows = ordered.map((r) => {
    const extra = extras.get(r.id) || {};
    return [
      r.name,
      r.teamName,
      r.trackName,
      r.tableLabel ?? '',
      // Empty for an entry the organizer added themselves, which is how the
      // two are told apart in the file as well as in the interface.
      extra.submitter ?? '',
      r.projectUrl ?? '',
      r.videoUrl ?? '',
      extra.description ?? '',
      r.rank ?? '',
      r.score ?? '',
      r.maxScore ?? '',
      r.judgesScored,
      r.judgesEligible,
    ];
  });
  return toCsv(headers, rows);
}

export function perJudgeCsv(results, notesByKey = new Map()) {
  const criteria = results.criteria;
  const headers = [
    'Judge',
    'Judge e-mail',
    'Judge finished',
    'Entry',
    'Team',
    'Track',
    ...criteria.map((c) => `${c.name} (/${c.max_score})`),
    'Judge total',
    'Criteria filled',
    'Complete',
    'Notes',
  ];
  const judgeMeta = new Map(results.judges.map((j) => [j.id, j]));
  const rows = [];
  for (const row of results.rows) {
    for (const js of row.judgeScores) {
      const judge = judgeMeta.get(js.judgeId);
      rows.push([
        js.judgeName,
        judge?.email || '',
        judge?.completedAt ? 'yes' : 'no',
        row.name,
        row.teamName,
        row.trackName,
        ...criteria.map((c) => {
          const v = js.values[c.id];
          return v === undefined || v === null ? '' : v;
        }),
        js.total,
        js.filled,
        js.complete ? 'yes' : 'no',
        notesByKey.get(`${js.judgeId}:${row.id}`) || '',
      ]);
    }
  }
  return toCsv(headers, rows);
}

/** Judge feedback only - the artefact organizers hand back to teams. */
export function notesCsv(results, noteRows) {
  const judgeMeta = new Map(results.judges.map((j) => [j.id, j]));
  const entryMeta = new Map(results.rows.map((r) => [r.id, r]));
  const headers = ['Entry', 'Team', 'Track', 'Judge', 'Notes', 'Updated at'];
  const rows = noteRows
    .filter((n) => (n.body || '').trim() !== '')
    .map((n) => {
      const entry = entryMeta.get(n.entry_id);
      return [
        entry?.name || '',
        entry?.teamName || '',
        entry?.trackName || '',
        judgeMeta.get(n.judge_id)?.name || '',
        n.body,
        n.updated_at,
      ];
    });
  return toCsv(headers, rows);
}
