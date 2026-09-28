/** Preloaded before every test file by the `test` script.
 *
 *  The per-IP rate limiter is sized from the host CPU count
 *  (src/config.js: writes = cpus * 300, floor 240), and the suite makes far
 *  more writes than that in a minute - every organizer it signs up, every
 *  entry, judge and score. On a 4-core laptop the ceiling is 1200 and the
 *  suite fits under it; on a 2-core CI runner it is 600 and the suite trips
 *  its own limiter, failing whichever test happens to be running when the
 *  budget runs out. That failure says `rate_limited` and points at an
 *  unrelated assertion, which is a genuinely confusing way to find out the
 *  machine has fewer cores.
 *
 *  Nothing in the suite asserts throttling behaviour, so lift it. Assigning
 *  only when unset keeps an explicit override working, which is how the
 *  limiter itself can still be exercised by hand.
 *
 *  config.js reads process.env when it is first imported, and `--import` runs
 *  before the test file that imports it, which is why this has to be a preload
 *  rather than a line in helpers.js - an ES module's imports are hoisted above
 *  its body.
 */
process.env.RATE_LIMIT_READ ??= '1000000';
process.env.RATE_LIMIT_WRITE ??= '1000000';
