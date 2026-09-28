# Changelog

All notable changes to Judgium are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Judgium follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Upgrading** is `git pull && npm install && restart`. Schema migrations apply
themselves once at boot, inside a transaction. Any release needing more than
that says so at the top of its entry.

## [Unreleased]

### Added

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
- `CONTRIBUTING.md`, `GOVERNANCE.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `MAINTAINERS.md`, `DCO` — contribution workflow, decision-making, private
  vulnerability reporting and the Contributor Covenant.
- Issue and pull-request templates, a CI workflow running the test suite on
  Node 20 and 22, and a DCO sign-off check on every commit in a PR.
- **AGPL-3.0 § 13 source offer.** Every page footer links to the corresponding
  source, and `GET /api/meta` reports `sourceUrl` and `version`. Operators
  running a modified build **must** set `SOURCE_URL` to their own source — the
  licence requires that the link reach the code actually running, not ours.

### Changed

- **Licence: MIT → [AGPL-3.0-only](LICENSE).** Judgium is a network application,
  and AGPL-3.0 § 13 extends the reciprocity obligation to anyone who offers it
  as a service: their users must be offered the corresponding source. MIT did
  not. Self-hosting, modification and commercial use are unchanged and need no
  permission. `package.json` `license` is now `AGPL-3.0-only`, without the
  "or any later version" clause.
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
