# Maintainers

The people with commit access to Judgium. Roles and how this list changes:
[`GOVERNANCE.md`](GOVERNANCE.md).

| Name | GitHub | Role | Since | Areas |
|---|---|---|---|---|
| Taiji Hagino | [@taijihagino](https://github.com/taijihagino) | Project lead | 2025-02 | Everything; final say on scope, releases, security and the trademark |

## Emeritus

Former maintainers, with thanks. Stepping back is normal and access is restored
on request.

*(none yet)*

## Reviewers by area

Who to `@`-mention on a PR. A reviewer is not necessarily a maintainer — being
useful here is the usual first step toward commit access.

| Area | Files | Reviewers |
|---|---|---|
| Scoring, ranking, rubrics | `src/lib/scoring.js`, `src/services/results.js` | @taijihagino |
| API, auth, sessions | `src/routes/`, `src/middleware/`, `src/lib/auth.js` | @taijihagino |
| Database, migrations | `src/db/` | @taijihagino |
| Frontend, accessibility | `public/js/`, `public/css/` | @taijihagino |
| Live updates, capacity | `src/lib/events.js`, `src/config.js` | @taijihagino |
| Deployment, Azure | `deploy/`, `.github/workflows/`, `web.config` | @taijihagino |
| Translations — en / ja | `public/i18n/en.json`, `ja.json` | @taijihagino |
| Translations — es / zh / ko | `public/i18n/es.json`, `zh.json`, `ko.json` | *seeking reviewers — see below* |

**We need native reviewers for Spanish, Chinese and Korean.** The strings ship
today with no native speaker checking them, which is exactly the kind of gap a
contributor can close in an afternoon. If you can read one of those locales,
open a Discussion and add yourself here in the same PR.
