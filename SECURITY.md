# Security Policy

## Reporting a vulnerability

**Do not open a public issue, pull request or Discussion for a security
problem.** A Judgium instance holds unannounced results and live judge
credentials; a public report is a working exploit against every deployment at
once, including ones mid-event.

Report it privately through **GitHub Private Vulnerability Reporting**:

> **[→ Report a vulnerability](https://github.com/judgium/judgium/security/advisories/new)**
>
> Or: repository → **Security** tab → **Advisories** → **Report a vulnerability**

The report is visible only to maintainers. It costs you nothing but a GitHub
account, and it keeps the whole exchange — questions, patch, credit, CVE — in
one place that becomes the published advisory. We deliberately publish no
security e-mail address; this channel is the only one, and it is the one we
watch.

If you cannot use GitHub at all, open a normal issue titled
`Security contact request` containing **no details of the problem** and asking
us to reach you. We will reply with a private channel.

### What to include

As much of this as you have — a report missing some of it is still worth sending:

- **What an attacker gets.** Read another organizer's competition? Write scores
  as a judge they are not? Escalate to `superadmin`? Read the database file?
- **Which surface** — `/admin`, `/j/<token>`, `/board/<slug>`, `/sysadmin`, or
  an `/api/...` route.
- **Reproduction** — requests, payloads, or a script. `curl` is ideal.
- **Version** — release tag or commit SHA, plus how it is deployed (local, Azure
  App Service, container, reverse proxy in front).
- **Whether you have disclosed it anywhere else**, and any deadline you are
  working to.

Please **redact judge tokens, session cookies and `SESSION_SECRET`** even in a
private report, and use a test instance with fake participants rather than a
real event's data.

### What happens next

| When | What |
|---|---|
| **3 working days** | We acknowledge and tell you who is handling it |
| **10 working days** | Our assessment: confirmed or not, and the severity we assign |
| **30 days** (critical/high) | Fix released, advisory published |
| **90 days** (medium/low) | Fix released, usually folded into a normal release |

We will tell you if a date is going to slip, and why. If you have not heard
anything in 10 working days, escalate by opening a public issue that says only
*"awaiting response on a private security report filed on &lt;date&gt;"* — no
details. That is a legitimate nudge, not a breach of this policy.

### Coordinated disclosure

We ask for **90 days** before public disclosure, or until a fix ships —
whichever is sooner. If a vulnerability is being exploited, we will move much
faster and would rather you told us that up front.

**Credit.** We name you in the advisory and the changelog unless you ask us not
to; tell us how you want to be credited. We run no bug-bounty programme and
cannot pay for reports.

**Safe harbour.** We will not pursue or support legal action against research
that follows this policy in good faith: testing only against instances you own
or have written permission to test, no access to real participants' data beyond
what is needed to demonstrate the flaw, no degradation of anyone's service, no
data destroyed or retained, and private reporting first. Testing against a
third party's Judgium deployment without their permission is outside this policy
and outside our ability to protect you.

## Supported versions

Judgium ships from `main`. Security fixes land on `main` and in the newest minor
release; older minors are not patched. If you are self-hosting, track the latest
release — the upgrade is `git pull && npm install && restart`, with schema
migrations applying themselves at boot.

| Version | Supported |
|---|---|
| Latest release / `main` | ✅ |
| Previous minor | Critical fixes only, for 90 days after its successor |
| Anything older | ❌ |

## Scope

**In scope:** everything in this repository — the API, the four authenticated
surfaces, the public leaderboard, judge-token handling, session and cookie
handling, the platform-administration routes and audit log, CSV/JSON export
escaping, rate limiting, the SQL layer, and the CSP and security headers.

**In scope even though it looks like configuration:** a default that is unsafe
out of the box, and anything in `deploy/provision-azure.sh` or `web.config` that
provisions an insecure deployment.

**Out of scope** (report as ordinary issues, or not at all):

- **Vulnerabilities in dependencies** with no exploitable path through Judgium.
  Report upstream; tell us if Judgium's usage is what makes it reachable.
- **An operator's own misconfiguration** — no `SESSION_SECRET`, a database on
  ephemeral storage, no HTTPS, `/sysadmin` exposed to the internet on purpose.
  Real risks, documented in the README; not defects in the code.
- **Missing hardening with no attacker** — a header that would be nice to add,
  a cookie flag that is already implied, output from an automated scanner with
  no described impact.
- **Social engineering, physical access, or a judge who forwards their own
  link.** A judge link is a bearer token by design; anyone holding it can score.
  Rotating it (Judges tab → new link) is the documented remedy.
- **Denial of service by volume.** Rate limiting here is meant to blunt hot
  loops, not to withstand a flood — that belongs to whatever fronts the app.
  A request that is *cheap to send and disproportionately expensive to serve*
  **is** in scope.
- **Self-XSS**, and anything requiring the victim to paste attacker-supplied
  code into their own console.

Uncertain? Send it. A report we rule out costs us ten minutes.

## What the design already assumes

Knowing the intended model saves you time, and tells you when something is a
real break rather than a deliberate trade-off. All of this is in the README's
*Security notes* section; the short form:

- **Judge links are bearer tokens.** 24 characters from an unambiguous alphabet,
  no account, no password — that is the product. They are rotatable per judge,
  and judge pages are `noindex`. A *guessable* or *enumerable* token is a
  vulnerability; a shared one is not.
- **Ownership failures return `404`, not `403`,** so competition ids are not
  probeable. The platform-admin API returns `403` on purpose: the route is
  public knowledge, the privilege is not.
- **Sign-in tells you nothing.** Wrong password, unknown account and suspended
  account are indistinguishable from outside, and suspension is checked *after*
  the password so it cannot be used to enumerate addresses.
- **`superadmin` has no self-service route.** Only `SUPERADMIN_EMAILS`, the
  `promote` CLI, or an existing administrator — and an administrator can never
  act on their own role or status. A path to self-promotion is a vulnerability.
- **The public leaderboard carries no judge names, per-judge scores or feedback.**
  Any leak of those through `/api/board/:slug` or an export is a vulnerability.
- **The frontend never assigns `innerHTML`,** and every page is served under
  `script-src 'self'; style-src 'self'; frame-ancestors 'none'`. A CSP bypass,
  or any path that gets organizer- or judge-authored text parsed as markup, is a
  vulnerability.
- **Every administrative write is in the audit log,** which outlives the accounts
  it refers to. A privileged write that leaves no trace is a vulnerability.

## What a platform operator can reach

The privacy guarantee above is about the **public leaderboard**, not about the
person running the deployment. Stated plainly, because a judge who was told
their individual scores are not published deserves to know who can in fact see
them.

**Through the API, a platform administrator cannot read somebody else's
competition.** `/api/competitions/:id` and every export answer `404` — not
`403` — to any account that does not own the competition, the `superadmin` role
included. `/sysadmin` shows that a competition exists and who owns it, and can
close, reopen or delete it, but cannot open its rubric, entries, scores or
exports.

**There are two ways round that, and both are worth knowing about.**

1. **Reset the owner's password and sign in as them.** A platform administrator
   can do this (`/sysadmin` → Accounts → Reset password) and then has everything
   the owner has, judge names and per-judge scores included. It is recorded:
   `user.password_reset` lands in the audit log with the administrator's
   address, the target account and the IP, and the audit log outlives the
   accounts it refers to. The owner also discovers it, because their own
   password no longer works. This is the intended escalation path — the trace is
   the point.

2. **Read the database file.** Anyone with filesystem access to
   `DATABASE_PATH`, `BACKUP_DIR` or a `npm run backup` snapshot has every score,
   every note, every judge name and e-mail, **every judge's still-valid link
   token**, and every password hash. **This leaves no trace at all** — the audit
   log is a table inside the same file.

   Automatic pre-delete snapshots multiply this: each is a full copy of the
   database at the moment before scores were destroyed, kept in
   `<BACKUP_DIR>/pre-delete/` until retention rotates it out. They exist so a
   mis-clicked reset is recoverable, and the cost is more copies of exactly the
   data above. `AUTO_SNAPSHOT_KEEP` bounds how many; `AUTO_SNAPSHOT=0` stops
   them being written at the price of irreversible deletes.

**What follows from that.** Whoever controls the host is inside the trust
boundary and no application-level rule changes it. If you host Judgium for other
people, say so in whatever terms you give them: the operator can reach judging
data, and only the password-reset route leaves evidence. If judges were promised
confidentiality beyond "not on the public board", that promise is yours to keep,
not the software's.

Reports that a platform administrator can escalate **by any route that is not
recorded in the audit log** are in scope and welcome — that is a real finding.
Reports that root can read a SQLite file are not.

## For operators

Before an event that matters, the short checklist:

1. **Set `SESSION_SECRET`.** Without it the key is generated at boot or kept on
   the data volume; the boot log and `/sysadmin` say which.
2. **Point `DATABASE_PATH` at persistent storage** (`/home/data/judgium.db` on
   Azure App Service). Its directory holds the WAL, session key and backups.
3. **HTTPS only.** Judge tokens travel in the URL path.
4. **`npm run backup` before the announcement.** `VACUUM INTO`, safe on a live
   instance with judges mid-scoring.
5. **Treat `BACKUP_DIR` as judging data.** Both the manual snapshots and the
   automatic `pre-delete/` ones are complete copies of the database — scores,
   feedback, judge names and e-mails, live judge link tokens, password hashes.
   Give the directory the same protection as the database, and do not copy one
   somewhere more public to look at it.
6. **Close sign-up** (`DISABLE_SIGNUP=1` or `SIGNUP_ALLOWLIST`) on anything
   internet-facing that is not meant to be a public service.
7. **Rotate a judge link** the moment one leaks. Instant, and it retires the old
   one.

## Advisories

Published as [GitHub Security Advisories](https://github.com/judgium/judgium/security/advisories)
and summarised in [`CHANGELOG.md`](CHANGELOG.md). Watch the repository
(*Watch* → *Custom* → *Security alerts*) to be notified.
