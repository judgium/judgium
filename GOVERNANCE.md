# Judgium Governance

Judgium is a small project with a single maintainer. This document says so
plainly, rather than describing a committee that does not exist, so that you can
judge the project's bus factor before you depend on it.

---

## Who decides

**Taiji Hagino** ([@taijihagino](https://github.com/taijihagino)) is the project
lead and the final decision-maker on everything: scope, design, what gets
merged, releases, the trademark, and this document.

This is a **benevolent-dictator model**. It is the right shape for a codebase
this size and it is not a permanent arrangement — see
[Growing the maintainer team](#growing-the-maintainer-team) below.

| Decision | Made by |
|---|---|
| Merging a bug fix | Any maintainer |
| Merging a new feature | Project lead, or a maintainer with the lead's agreement |
| Adding a runtime dependency | Project lead |
| Scope: what Judgium is and is not | Project lead |
| Cutting a release | Project lead |
| Security response and disclosure timing | Project lead ([`SECURITY.md`](SECURITY.md)) |
| Code-of-conduct enforcement | Project lead ([`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)) |
| Trademark permission | Trademark owner ([`TRADEMARKS.md`](TRADEMARKS.md)) |
| Licence changes | Project lead — but see [the constraint](#licensing-and-relicensing) |

## How decisions get made

**In public, in the issue tracker.** A decision that affects users is made on an
issue or PR thread where you can read the reasoning and disagree with it. If a
decision gets made in a private channel, it gets written up in the relevant
issue before it is acted on. The exceptions are security reports before a fix
ships, and code-of-conduct reports, both of which stay private.

**Consensus first, lead decides when it stalls.** Most things are settled by
someone making a good argument. When a thread has stopped converging, the
project lead decides and says why. A decision you disagree with is not a
personal one, and reopening it later with new evidence is legitimate.

**Silence is not consent.** If a proposal gets no response in two weeks, ping
it. No response is a signal about maintainer capacity, not about the idea.

## Service levels

What you can actually expect, so you are not left guessing:

| | Target |
|---|---|
| First response on a new issue | 1 week |
| First review on a pull request | 1 week |
| Security acknowledgement | 3 working days ([`SECURITY.md`](SECURITY.md)) |
| Critical security fix released | 30 days |
| Trademark permission request | 30 days ([`TRADEMARKS.md`](TRADEMARKS.md)) |

These are targets from one person with a day job, not an SLA. **If a PR has had
no response in three weeks, comment `@taijihagino ping` on it.** That is
encouraged, not rude.

**If the project goes quiet for 6 months** — no releases, no maintainer
responses — treat it as unmaintained and fork it. The licence is AGPL-3.0
precisely so that you can. Rename it ([TRADEMARKS.md § 4](TRADEMARKS.md#4-forks-must-be-renamed))
and carry on; a good fork of a stalled project is a service to everyone.

## Growing the maintainer team

A single maintainer is a risk, and the intent is to reduce it. There is no
application process; the path is:

1. **Contribute.** Several merged PRs that needed little rework. Reviewing other
   people's PRs usefully counts for as much as writing your own.
2. **The lead invites you** to commit access. Nothing to apply for; if you want
   it, say so in a Discussion and we will talk about what is missing.
3. **Maintainer**: triage and label issues, review and merge bug fixes, cut
   patch releases. Features still go past the lead.

Maintainers are listed in [`MAINTAINERS.md`](MAINTAINERS.md). Stepping back is
normal and needs no explanation — open a PR removing yourself. Access is removed
after 12 months of inactivity, with a heads-up first, and restored on request.

**Succession.** If the lead becomes unavailable, the longest-serving active
maintainer takes over the repository and the release process. The **trademark
does not transfer automatically** — it is personal property, and a successor
maintainer without a written assignment must rename the project. That is an
honest limitation of holding the mark personally rather than in a foundation,
and it is the main thing that would change if the project moves to an
organisation.

## Licensing and relicensing

**The code is [AGPL-3.0-only](LICENSE).** Contributions come in under the
[DCO](DCO) — contributors keep their copyright and licence it to everyone under
AGPL-3.0. There is no CLA and no copyright assignment.

**The consequence, stated plainly: the project lead cannot relicense Judgium.**
Once someone else's AGPL-3.0 contribution is merged, changing the licence needs
the agreement of every contributor whose code remains, or the removal of that
code. There is no mechanism here for a unilateral licence change, and that is
deliberate — it is the guarantee a DCO gives you that a CLA would not.

What that means concretely:

- **A proprietary or source-available fork of this code is not possible**, by us
  or by anyone. A CLA would have kept that door open; we chose to close it.
- **A hosted commercial service is possible**, and is being considered. AGPL-3.0
  permits anyone — including the copyright holder — to run the software as a
  service. § 13 requires that every user interacting with it over a network be
  offered the complete corresponding source, and a Judgium-operated service will
  comply with that like any other operator: the source link in the interface
  footer, pointing at the running version. **Any changes made for that service
  are AGPL-3.0 and land in this repository.** It would be operating the same
  software, not a privileged build of it.
- **If a commercial offering ever needed proprietary components**, they would
  have to be genuinely separate programs with their own repositories, not
  additions to this one — and we would say so here first.
- **The trademark, not the licence, is what distinguishes the official service.**
  That is the whole reason [`TRADEMARKS.md`](TRADEMARKS.md) exists as a separate
  document: anyone may run this code commercially, and nobody else may call their
  service Judgium.

Relicensing to a *later* AGPL version is not planned; the licence is
AGPL-3.0-**only**, without the "or any later version" clause, so a future FSF
licence does not apply automatically.

## Scope

Judgium runs hackathon judging: entries, rubrics, judges, scoring, leaderboard,
exports. Deliberately not in scope, and best served by a fork:

- Submission collection, repository review, CI or demo hosting
- Ticketing, attendee registration, team formation, venue logistics
- A plugin system, a second database backend, or a build step
- Event-specific scoring rules that are not expressible as a rubric

"This belongs in a fork" is a normal and respectful answer here, not a
rejection. The [rename checklist](TRADEMARKS.md#4-forks-must-be-renamed) exists
to make taking that answer easy.

## Releases

Semantic versioning. Tagged on `main`, with a [`CHANGELOG.md`](CHANGELOG.md)
entry and a GitHub release; security releases additionally get an advisory.

- **Patch** — bug fixes, security fixes, translations. As needed.
- **Minor** — features, new locales, additive schema migrations. Roughly
  quarterly.
- **Major** — anything that breaks a documented API, changes the scoring maths,
  or requires an operator to act on upgrade. Announced in an issue first, with
  the migration path, at least 30 days ahead.

**The upgrade contract.** `git pull && npm install && restart`. Schema
migrations apply themselves once at boot inside a transaction. A release that
needs more than that says so at the top of its changelog entry and its release
notes.

## Changing this document

By pull request, like anything else. Substantive changes — how decisions are
made, service levels, the licence section — stay open for comment for 14 days
before merging. The project lead decides, and records the reasoning on the PR.

---

*Judgium Governance v1.0 — 2026-09-28.*
