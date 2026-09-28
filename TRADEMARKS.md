# Judgium Trademark Policy

**The code is free. The name is not.** Judgium's source is licensed under
AGPL-3.0 (see [`LICENSE`](LICENSE)), and that licence deliberately grants no
rights to the project's name or logo — AGPL-3.0 § 7(e) exists precisely so that
a trademark can be held back while the code is given away. This document is
that reservation, written out in full.

Its purpose is narrow: **a person who arrives at a Judgium deployment should be
able to tell whether it is ours.** Nothing here is meant to restrict what you
can do with the code.

- Owner: **Taiji Hagino** ("we", "us")
- Marks covered: the word **Judgium**, the Judgium logo, the Judgium wordmark,
  and any confusingly similar variant (Judgium.io, JudgiumHQ, Judgeum, ジャジウム, …)
- Version: 1.0, effective 2026-09-28
- Applies to: everyone, including contributors and employees

> This is a project policy, not legal advice, and it does not enlarge or reduce
> anyone's rights under trademark law. If you need certainty for a commercial
> plan, talk to your own lawyer — and to us, via
> [Discussions](https://github.com/judgium/judgium/discussions).

---

## The short version

| You want to… | Allowed? |
|---|---|
| Read, run, modify, self-host the code — even commercially | **Yes**, under AGPL-3.0, no permission needed |
| Say "this is built on Judgium" / "a fork of Judgium" | **Yes** (§ 2) |
| Say "Compatible with Judgium" | **Yes**, under the conditions in § 5 |
| Publish a modified build still called "Judgium" | **No** (§ 3, § 4) |
| Use the logo for your own service, product or fork | **No** (§ 3) |
| Register a domain, org or app-store listing containing "Judgium" | **No** (§ 3) |
| Write about, review, teach or criticise Judgium | **Yes**, always (§ 6) |

---

## 1. What AGPL-3.0 already gives you

You do not need this document, or our permission, to:

- use Judgium for any purpose, including a paid commercial event;
- read, study and modify the source;
- run a modified copy privately or as a service;
- redistribute the source or a modified version.

Your obligations for those come from AGPL-3.0 alone — principally § 5 (mark your
changes and keep the licence notices) and § 13 (anyone who interacts with your
instance over a network must be offered its complete corresponding source).

**Trademark rules never gate the code.** If a rule below would stop you from
exercising an AGPL-3.0 right, the licence wins and the rule does not apply.

## 2. Nominative use — always permitted

You may use the word "Judgium" without asking, in plain text, to refer
truthfully to this project. This is nominative use and it is how trademark law
is supposed to work.

```
✅  "Acme Scoreboard is a fork of Judgium."
✅  "Deployed on top of Judgium 1.2.0."
✅  "Imports rubrics from Judgium."
✅  "We migrated off Judgium last year."
✅  "Judgium is slow at 500 entries."          ← criticism is nominative use
✅  A talk titled "Running a hackathon with Judgium"
```

Keep it to these limits:

1. **Plain text, not branding.** The word in a sentence, not the logo, not our
   typeface or colours, and not styled to look like a Judgium product name.
2. **Not in your own name.** Not in your project name, product name, company
   name, domain, GitHub org, package name or app-store listing.
   `acme-scoreboard` ✅ · `judgium-pro` ❌
3. **Attribute on first prominent use.** "Judgium is a trademark of Taiji
   Hagino" in a footer, README or about page. Once per document is enough.
4. **No implied endorsement.** Don't suggest we built, blessed, reviewed,
   support or partner with your thing.

## 3. Uses that require our written permission

Everything in this section is **prohibited unless we agree in writing** —
because each one causes a reader to mistake something for the official project:

**a. Passing your deployment off as official.** Describing your instance as
"Judgium", "Judgium Cloud", "Judgium Official", "the Judgium service", or any
wording that a reasonable visitor would read as run by us. If you host Judgium
for other people, the service needs your own name.

**b. Any use of the logo or wordmark.** Our mark files — including
`public/favicon.svg` and everything under `docs/brand/` — are not covered by
AGPL-3.0. See § 4 of [`docs/brand/BRAND.md`](docs/brand/BRAND.md) for the one
narrow exception (an unmodified build).

**c. The name in an identifier you control.** Domains, subdomains, GitHub or
npm org and package names, social handles, app-store listings, container image
names or SaaS tenant names containing "judgium" or a confusable spelling.

**d. Merchandise and event branding.** Shirts, stickers, sponsor boards,
conference booths and swag carrying the marks.

**e. Trademark registration.** Do not register these marks, or anything
confusingly similar, in any jurisdiction or class.

**f. Certification claims.** "Judgium Certified", "Judgium Partner",
"Judgium Approved", "Official Judgium Integration" — there is no such programme
today, so the claim would be false as well as infringing.

To ask, open a [Discussion](https://github.com/judgium/judgium/discussions)
with what you want to do, where the mark would appear, and a mock-up or link.
We answer within 30 days. Permission is specific to what you described, is not
transferable, and we may withdraw it if the use changes materially. **Silence is
not permission.**

## 4. Forks must be renamed

A fork you publish, redistribute or host for others **must carry its own name.**

**Pick a name that stands on its own.** Not a prefix, suffix or infix of ours:

```
✅  Acme Scoreboard · PitchScore · Hakoniwa Judge · Tribune
❌  Judgium Pro · Judgium+ · MyJudgium · Judgium-CE · Judgium Community
❌  Judgeum · Judgium.io · jud9ium         ← confusable spellings
```

**What to change when you rename** (grep is enough — these are all the places):

| Where | What |
|---|---|
| `package.json` | `name`, `description` |
| `public/i18n/*.json` | `app.name`, `app.tagline`, `app.description` (all five locales) |
| `public/*.html` | `<title>`, `<meta name="description">`, the `topbar__brand` text |
| `public/favicon.svg` | replace with your own mark |
| `docs/brand/` | **delete the directory** — those assets are not yours to ship |
| `NOTICE`, `README.md` | keep our copyright line; add your own; state that you are not us |
| default DB filename | `judgium.db` → your own (cosmetic, but it shows up in ops docs) |
| `TRADEMARKS.md` | replace with your own policy, or delete it |

**What to keep.** AGPL-3.0 § 5 requires you to keep the copyright notices, the
licence, and the statement that the work is modified — renaming the product does
not let you drop attribution. Say plainly somewhere visible: *"<Your name> is a
fork of Judgium. It is not affiliated with or endorsed by the Judgium
project."*

**Private forks are exempt.** Rules in this section bite on publication and on
hosting for others, not on your own branch or your company's internal instance.
Change the name whenever you like before then.

**Pull requests are exempt.** A branch in your GitHub fork that exists to send
us a patch is not a renamed product. Keep the name; send the PR.

## 5. "Compatible with Judgium" — permitted under conditions

You may state compatibility without asking, in exactly this shape:

```
✅  "Compatible with Judgium"
✅  "Works with Judgium 1.x"
✅  "Judgium-compatible CSV export"
✅  "Imports Judgium leaderboard exports"
```

All five conditions must hold:

1. **It is true, and you have tested it.** Name the version or range you tested
   against. Compatibility claimed against a future or unreleased version is not
   a true claim.
2. **The claim is about interoperation**, not about origin or quality — an
   integration, an importer, a plugin, a matching data format, a migration
   path.
3. **"Judgium" is an adjective, never the subject.** It qualifies your product's
   name; it does not replace it. "Acme Board, compatible with Judgium" ✅ ·
   "Judgium Board by Acme" ❌
4. **Your own name is at least as prominent** — same or larger size, same or
   earlier position. Ours must not be the thing the eye lands on first.
5. **Text only, with the § 2 attribution line.** No logo, no lock-up, no badge
   composed from our mark, no border or colour scheme that reads as a seal of
   approval.

Wording that goes beyond compatibility — "Judgium Certified", "Official
Judgium Integration", "Powered by Judgium™ Technology" — is § 3(f) and needs
permission.

## 6. What this policy never restricts

To be explicit, because trademark policies are often read more broadly than
they are meant:

- **Speech about the project.** Articles, blog posts, talks, tutorials,
  documentation, videos, academic papers, reviews, comparison tables,
  benchmarks, and criticism. Including unflattering criticism. Referring to us
  by name is the only way to do any of it.
- **Accuracy.** Screenshots of the real UI, our name in a feature comparison,
  our name in your commit messages or issue tracker.
- **Parody and commentary**, to the extent your jurisdiction protects them.
- **Anything AGPL-3.0 grants.** See § 1.

## 7. Enforcement

We enforce to prevent confusion, not to punish. Expect, in order: a note
explaining the problem and what would fix it; a reasonable deadline (normally
30 days, longer if a rename needs coordinating); and only then a formal request
or a platform report. We would much rather help you pick a name.

If you believe a use is fine and we have read it wrong, say so — we will look
again. If you spot a confusing use of the marks in the wild, tell us in
[Discussions](https://github.com/judgium/judgium/discussions).

Not enforcing in one instance does not waive the marks generally.

## 8. Changes to this policy

We may revise this policy; changes are announced in
[`CHANGELOG.md`](CHANGELOG.md) and carry a new version number and date.
**A use that complied when you started stays compliant for 90 days after a
revision**, so you have time to adjust. Written permissions already granted
survive under the terms they were granted on.

---

*Judgium Trademark Policy v1.0 — 2026-09-28. Adapted in structure from the
trademark policies of the Linux Foundation, Rust and Python; the terms are our
own. This document is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
so you may reuse it for your own project — but describe your own marks, not
ours.*
