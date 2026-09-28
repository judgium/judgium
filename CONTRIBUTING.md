# Contributing to Judgium

Thanks for being here. Judgium is a small, deliberately dependency-light
codebase, and that is the thing we most want to keep true. A patch that removes
code is as welcome as one that adds a feature.

- **Code of conduct:** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — applies everywhere
- **Licence:** contributions are inbound AGPL-3.0, certified by a DCO sign-off ([below](#sign-your-commits-dco))
- **Who decides:** [`GOVERNANCE.md`](GOVERNANCE.md)
- **Security bugs:** do **not** open an issue — [`SECURITY.md`](SECURITY.md)
- **The name and logo:** [`TRADEMARKS.md`](TRADEMARKS.md) — the code is free, the brand is not

---

## Getting set up

```bash
git clone https://github.com/judgium/judgium.git
cd judgium
npm install
npm run seed     # demo hackathon: 12 entries, 5 judges, prints every link
npm start        # http://localhost:3000
npm test         # 107 tests, ~seconds, no network and no browser needed
```

`npm run dev` restarts on save. There is no build step and no bundler — the
frontend is ES modules served straight from `public/`, so a reload is the whole
feedback loop.

If you use the devcontainer (VS Code → *Reopen in Container*), all of the above
is already done.

## Before you write code

**Open an issue first for anything beyond a bug fix.** Not bureaucracy — it is
much cheaper to find out in a comment thread than in a review that a feature
belongs in a fork, or that we already tried it. Small fixes, typos, translations
and test additions need no issue; just send the PR.

Things likely to be declined, so you know before you invest the time:

- **A new runtime dependency.** Two is the budget (`express`,
  `better-sqlite3`). Make the case in an issue first; the bar is that it
  replaces more code than it adds.
- **A build step, bundler, transpiler or frontend framework.** "No build step"
  is a feature — it is what makes this deployable to a plain Node host.
- **A second database backend.** One SQLite file is the durability story.
- **Features that only make sense for one event's rules.** Judgium ships the
  rubric machinery; a bespoke scoring formula belongs in your own fork.

Things we will nearly always take: bug fixes with a failing test, accessibility
fixes, i18n corrections and new locales, documentation that unbreaks something
confusing, and deletions.

## House style

The codebase has strong conventions. Match them rather than your own habits:

- **ES modules, Node ≥ 20.11, no TypeScript.** `.js` everywhere.
- **Two-space indent, single quotes, semicolons, trailing commas.** No linter is
  enforced in CI; read a neighbouring file and copy it.
- **Comments explain *why*.** Look at the block comments at the top of
  `src/lib/scoring.js` or `src/db/migrations.js` for the register we write in —
  full sentences, the reasoning, the thing that would otherwise surprise the
  next reader. Do not narrate what the code plainly says.
- **Build DOM nodes, never assign `innerHTML`.** The CSP is `script-src 'self'`
  and every page's text can be organizer- or judge-authored. `public/js/dom.js`
  has the helpers.
- **Errors go through `src/lib/errors.js`.** Ownership failures return `404`,
  not `403` — competition ids must not be probeable. The platform-admin API is
  the documented exception.
- **Schema changes.** `src/db/schema.sql` is only the baseline for a *fresh*
  database and is all `CREATE ... IF NOT EXISTS`, so it cannot alter an existing
  table. Anything touching an existing table goes in `src/db/migrations.js` as a
  new, appended, once-only entry. Never edit or reorder a migration that has
  shipped.
- **Every write is rate-limited and validated** by the middleware already in
  `src/app.js`; new routes inherit it — don't route around it.

## Tests

`npm test` must pass. Node's built-in runner, no framework.

`npm test` preloads `test/setup.mjs`, which lifts the per-IP rate limit for
the run. The limiter is sized from the host CPU count, and the suite makes more
writes than a two-core machine allows in a minute -- without the preload it
trips its own limiter and fails whichever test was running when the budget ran
out, reporting `rate_limited` against an unrelated assertion. Run
`RATE_LIMIT_WRITE=600 node --test "test/*.test.js"` to reproduce that
deliberately; the preload only assigns when the variable is unset.

| Add a… | Test it in |
|---|---|
| Scoring or ranking change | `test/scoring.test.js` |
| API route | `test/api.test.js` |
| Platform-admin route | `test/sysadmin.test.js` |
| Page behaviour | `test/frontend.test.js` (jsdom) |
| Export or CSV change | `test/csv.test.js` |
| Anything concurrent | `test/concurrency.test.js` |

**A bug fix needs a test that fails before it and passes after.** Put it in the
PR so a reviewer can check out the parent commit and watch it fail.

**New i18n keys go into all five locale files** (`en`, `ja`, `es`, `zh`, `ko`)
with identical keys and identical interpolation placeholders — `test/frontend.test.js` asserts
this, so a half-translated string fails CI rather than shipping. If you cannot
translate a string, copy the English text into the other four and say so in the
PR; a native speaker can follow up.

## Sign your commits (DCO)

Judgium uses the [Developer Certificate of Origin](DCO) rather than a CLA. There
is no copyright assignment: **you keep the copyright in your contribution** and
licence it to everyone under AGPL-3.0, the same licence as the rest of the
project.

Sign off every commit:

```bash
git commit -s -m "Fix drop-high/low with exactly three judges"
```

`-s` appends the line that does the certifying:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and e-mail must match your commit author identity, and must be one you
can be reached at — a pseudonym you use consistently is fine, `anonymous` is
not. By adding it you certify the four statements in [`DCO`](DCO): in short,
that you wrote the patch, or that you have the right to submit it under this
licence.

Make it automatic:

```bash
git config --global format.signoff true                    # every commit, every repo
git config alias.ci 'commit -s'                            # or just this repo
```

Forgot? `git commit --amend -s --no-edit` for the last one, or for a branch:

```bash
git rebase --signoff main && git push --force-with-lease
```

CI checks every commit in the PR. **Every** commit needs the line, not just the
last.

> **Why DCO and not a CLA.** A CLA would let us relicense your code later; a DCO
> does not, and we would rather not hold that power than ask you to grant it.
> The consequence, stated plainly: contributed code can only ever ship under
> AGPL-3.0. See [`GOVERNANCE.md`](GOVERNANCE.md#licensing-and-relicensing) for
> what that means for the project's future.

## Pull requests

1. **Branch from `main`.** One logical change per PR — a refactor and a feature
   in one branch is two reviews pretending to be one.
2. **Fill in the template.** What changes, why, how you verified it. A
   before/after screenshot for anything visual; the exact commands you ran for
   anything operational.
3. **Keep your own fork's name.** A PR branch is not a redistributed fork, so
   [TRADEMARKS.md § 4](TRADEMARKS.md#4-forks-must-be-renamed) does not apply to
   it. Leave the branding alone.
4. **Green CI.** Tests, and the DCO check.
5. **Review.** A maintainer responds within a week — see
   [`GOVERNANCE.md`](GOVERNANCE.md) for who and for what happens if they don't.
   Expect questions; they are about the code, not about you.
6. **Merge.** Maintainers squash-merge and write the changelog entry. You do not
   need to touch [`CHANGELOG.md`](CHANGELOG.md) yourself.

Rebase rather than merge `main` into your branch, and force-push with
`--force-with-lease`.

## Reporting bugs

Use the issue templates. What makes a report actionable here:

- **Version** (`package.json` version or commit SHA) and how you run it — local,
  Azure App Service, Docker, something else.
- **Which surface** — `/admin`, `/j/<token>`, `/board/<slug>`, `/sysadmin`.
- **Scale**, when it might matter: entries, judges, criteria, concurrent
  viewers. Most interesting bugs here are scale- or concurrency-dependent.
- **The boot log.** It prints the detected capacity, the database path and which
  of the three session-key sources is in effect — that last one explains a
  surprising share of "it logged everyone out" reports.
- **Redact before pasting.** Judge links are bearer tokens: `/j/<token>` grants
  scoring access to anyone holding it. Replace the token with `<token>`. Same
  for `SESSION_SECRET` and any real participant names or e-mails.

Never put a security vulnerability in an issue. [`SECURITY.md`](SECURITY.md).

## Translations

Adding a locale is one of the most useful things you can do, and it is
self-contained:

1. Copy `public/i18n/en.json` to `public/i18n/<code>.json` and translate the
   values. Keep every key and every `{placeholder}`.
2. Add the code to `LOCALES` in `public/js/i18n.js` **and** in
   `src/lib/templates.js`, and a `lang.<code>` label to all locale files.
3. Add a `normalize()` case in `public/js/i18n.js` if the language has common
   regional tags.
4. `npm test` — the key-parity test tells you what you missed.

Translate the interface strings; leave the brand name and tagline as they are
([BRAND.md § 2](docs/brand/BRAND.md#2-name) has the approved ジャッジアム rendering).

## Questions

[Discussions](https://github.com/judgium/judgium/discussions) for anything
open-ended — "is this a bug?", "would you take a PR for X?", "how should I run
this for 400 entries?". Issues are for things with a definite answer.
