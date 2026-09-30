# Changelog

All notable changes to Judgium are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Judgium follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Upgrading** is `git pull && npm install && restart`. Schema migrations apply
themselves once at boot, inside a transaction. Any release needing more than
that says so at the top of its entry.

## [Unreleased]

### Added
- **`entries.csv` export.** The roster as entered rather than as ranked: name,
  team, track, table, who submitted it, the repository and recorded-demo URLs,
  the description, and the scoring state, in the organizer's own entry order.
  `leaderboard.csv` answers who won and deliberately carries none of it.
- `full.json` entries now include `description` and `submittedBy`. Both existed
  in the database and reached the judge scorecard, but no export carried them,
  so a snapshot could not reconstruct what a participant actually submitted —
  which is the whole of the entry when judging asynchronously.
- Two more frames of the participant surface, so all three of its states are
  shown: opening the link (sign in or create an account) and the submission
  form, alongside the list of submissions that was already there. The
  `/enter/<slug>` frames now sit under their own heading in the READMEs, since
  sandwiched between two organizer-console screenshots they read as more of the
  same.

### Fixed

- **`hidden` had no effect on styled elements.** The sign-out button on the
  submission page stayed visible to a signed-out visitor: the attribute was set,
  but `.btn { display: inline-flex }` outranks the user agent's
  `[hidden] { display: none }`, so the element rendered anyway. `app.css` now
  carries an explicit `[hidden] { display: none !important }`. This was the only
  place the codebase toggled `hidden`, so nothing else was affected.
- Screenshots of the submission surface: the organizer's submission-window card
  and what an entrant sees at `/enter/<slug>`, both embedded in the READMEs.
  The whole set was recaptured so it comes from one consistent seed, and the
  Screens section now follows an event through submission as well as judging.
- `npm run seed` creates a participant account, opens the submission window, and
  attributes two of its twelve entries to that participant with a repository and
  a recorded-demo URL. The entry count is unchanged, so a fresh seed
  demonstrates asynchronous judging and the mixed organizer/entrant case without
  anything having to be set up by hand. It prints the submission link and the
  participant's credentials alongside the judge links.

- **Participant self-submission.** A sixth surface at `/enter/<slug>`, reached
  through a link the organizer shares rather than any public list of
  competitions. Entrants create their own account there and submit their own
  projects: name, team, track, description, repository URL and demo-video URL.
  - **The submission window is a single flag** (`submissionsOpen`, Setup tab).
    Turning it off is the deadline: no new entries, no edits, no withdrawals.
    Entrants keep read access to what they sent. It defaults to off, so
    upgrading does not open a competition that already exists.
  - **No cap, no duplicate detection, no approval queue.** One account may
    submit any number of entries to one competition; hackathons that allow
    several attempts per team are normal. A judge who finds an entry invalid
    leaves it unscored, and `scoring.js` already excludes a judge with no values
    from that entry, so an entry nobody scores is simply unranked.
  - **Participant accounts are walled off.** A new `participant` role, plus a
    `requireOrganizer` gate on the competition, roster and export routers --
    without it an account created through a submission link could have run a
    competition of its own. Somebody else's submission reads as 404.
  - Entries now carry `submitted_by`; the Entries tab names the submitter, and
    entries an organizer added themselves show none.
  - Schema migration `003_participant_submissions`, applied at boot.
  - Ten tests in `test/participant.test.js` covering the window, the absence of
    a cap, cross-participant isolation, the role wall, and the repository and
    video URLs reaching the judge.

- `TRADEMARKS.md` — trademark policy for the Judgium name and logo, reserved
  under AGPL-3.0 § 7(e). Nominative use and "Compatible with Judgium" claims are
  permitted under stated conditions; redistributed forks must be renamed.
- `docs/brand/` — brand guidelines and the SVG marks (mark, monochrome mark,
  wordmark), together with `docs/brand/LICENSE-BRAND`. **These files are excluded
  from AGPL-3.0.**
- `NOTICE` — copyright, the AGPL-3.0 § 7(e) trademark term, and the third-party
  dependency list.
- `README-ja.md` — Japanese README, with a language switcher at the top of both
  files. The five-locale interface always shipped; the documentation did not.
- Screenshots of all five surfaces — the four organizer console tabs, the judge
  scorecard, the public leaderboard and the platform view — embedded in both
  READMEs in the order an event runs.
- `CONTRIBUTING.md`, `GOVERNANCE.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `MAINTAINERS.md`, `DCO` — contribution workflow, decision-making, private
  vulnerability reporting and the Contributor Covenant.
- Issue and pull-request templates, a CI workflow running the test suite on
  Node 20 and 22, and a DCO sign-off check on every commit in a PR.
- **AGPL-3.0 § 13 source offer.** Every page footer links to the corresponding
  source, and `GET /api/meta` reports `sourceUrl` and `version`. Operators
  running a modified build **must** set `SOURCE_URL` to their own source — the
  licence requires that the link reach the code actually running, not ours.

- The Judgium mark, as a blue disc with a white **J**, applied as the favicon,
  the Apple touch icon and a logo in every page header. Served from
  `public/brand/`, which — like `docs/brand/` — is excluded from AGPL-3.0.

### Changed

- **Licence: MIT → [AGPL-3.0-only](LICENSE).** Judgium is a network application,
  and AGPL-3.0 § 13 extends the reciprocity obligation to anyone who offers it
  as a service: their users must be offered the corresponding source. MIT did
  not. Self-hosting, modification and commercial use are unchanged and need no
  permission. `package.json` `license` is now `AGPL-3.0-only`, without the
  "or any later version" clause.
- **Interface palette moved from purple to the blue of the mark.** All ten
  accent tokens in `public/css/app.css`, both themes. The interface sits a shade
  deeper than the mark on purpose: white text on the mark's own `#2882fc` is
  3.69:1, under the 4.5:1 WCAG AA asks for, so the palette keeps the hue and
  drops the lightness. Every one of the twelve foreground/background pairs that
  actually occurs was measured; the lowest is now 5.47:1, and ten of the twelve
  match or beat what purple achieved.
- Screenshots recaptured against the blue interface, headlessly rather than as
  window screenshots — the set is consistent, reproducible from a documented
  script, and 1.9 MB instead of 3.2 MB.
- `public/favicon.svg` removed; the AGPL-3.0 carve-out now names the
  `public/brand/` directory instead of a single filename, in `NOTICE`,
  `docs/brand/LICENSE-BRAND`, `TRADEMARKS.md` and both READMEs, so adding an
  icon no longer means editing three legal documents.
- Copyright holder recorded as Taiji Hagino.
- `README.md` — licence and trademark sections, a documentation index and the
  source-link requirement for operators.

## [1.0.0] — 2026-09-28

First public release. Everything below predates open-sourcing and is recorded
here as the starting point.

### Added

- **Five surfaces** — landing/sign-in, organizer console (`/admin`), judge
  scorecard (`/j/<token>`), public leaderboard (`/board/<slug>`), platform
  administration (`/sysadmin`).
- **Rubric scoring** — per-criterion maximums in `points` mode, per-criterion
  percentages in `weighted` mode, both stored so the mode can be switched
  without re-entering the rubric. Four starter rubrics. Track-specific criteria
  layered on top of shared ones.
- **Judge links** — 24-character bearer tokens from an unambiguous alphabet, no
  account and no install, rotatable per judge with the old link retired
  instantly. Scores autosave per entry as they are typed; a scorecard can be
  marked complete, reopened by an organizer, or cleared.
- **Aggregation** — judge totals averaged or summed; optional drop high/low,
  which engages only once three judges have scored an entry so it can never
  erase a small panel. Partial scorecards count, with blanks as zero, and every
  row reports `judgesScored / judgesEligible`.
- **Live leaderboard** over Server-Sent Events, coalesced to at most one push
  per throttle window, memoised against the competition's `rev`, with an
  automatic polling fallback when the per-instance subscriber ceiling is
  reached.
- **Exports** — leaderboard CSV, per-judge breakdown CSV, judge-feedback CSV and
  a full JSON snapshot. UTF-8 BOM so Excel opens CJK correctly; leading `=`,
  `+`, `-` and `@` neutralised against formula injection.
- **Platform administration** — cross-tenant overview, account management
  (promote, demote, suspend, reinstate, provision, reset password, delete with
  cascade), competition management, and an append-only audit log that outlives
  the accounts it refers to. The `superadmin` role has no self-service route,
  and an administrator cannot act on their own role or status.
- **Five languages** — English, Japanese, Spanish, Chinese, Korean. A judge's
  choice is stored against their link and follows them to a second device.
- **Durability** — one SQLite file in WAL mode; `npm run backup` snapshots via
  `VACUUM INTO`, safe against a live instance with judges mid-scoring. Session
  keys survive restarts, with the active source reported in the boot log and at
  `/sysadmin`. `src/db/migrations.js` upgrades existing deployments in place.
- **Capacity sizing** from the host's CPU count and memory at boot, with every
  derived limit overridable by environment variable and printed on start-up.
- **Azure App Service deployment** — `deploy/provision-azure.sh` and a GitHub
  Actions workflow; `web.config` included for Windows App Service.
- **107 tests** covering scoring, CSV, API, concurrency (15 judges × 20 entries
  × 4 criteria with zero lost cells, 40 simultaneous SSE viewers, a 250-entry
  board), persistence, platform administration, and all five pages through
  jsdom — no browser and no network.

[Unreleased]: https://github.com/judgium/judgium/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/judgium/judgium/releases/tag/v1.0.0
