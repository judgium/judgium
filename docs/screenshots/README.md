# Screenshots

The images the README's **Screens** section renders. All captures come from the
demo data `npm run seed` builds, so nothing in them is real.

## What is here

The set is complete. `README.md` and `README-ja.md` embed all nine in the order
an event runs, not in the order below.

| File | Page | Shows |
|---|---|---|
| `admin-rubric.png` | `/admin` → Rubric | Weighted mode, 25/20/20/15/10/10 |
| `admin-judges.png` | `/admin` → Judges | Private links, progress, rotate/reopen/clear |
| `admin-submissions.png` | `/admin` → Setup | The submission window and the `/enter/<slug>` link |
| `enter-submissions.png` | `/enter/<slug>` | A participant's own submissions, with repo and demo links |
| `admin-entries.png` | `/admin` → Entries | 12 entries; two name a submitter, ten do not |
| `judge-scorecard.png` | `/j/<token>` | A submitted card with the description and both URLs |
| `board.png` | `/board/<slug>` | Ranked board with track filter, live indicator, full-screen |
| `admin-results.png` | `/admin` → Results | Live ranking with `judgesScored / judgesEligible` |
| `sysadmin-overview.png` | `/sysadmin` → Overview | Counters and the storage/durability panel |

## Nice to have

Not blocking anything, but each would earn its place:

- **`judge-scorecard-mobile.png`** — the scorecard at phone width. The interface
  is mobile-first and judges really do use phones, so this is the capture that
  best contradicts the assumption that it is a desktop tool.
- **A board with a genuine tie.** The current one has ranks 3 and 4 at 0.03
  apart, which is close but does not show tie handling — tied entries share a
  rank and the next rank skips. Scoring two entries identically would
  demonstrate it.
- **`enter-closed.png`** — the submission page after the deadline, which is
  read-only and says so.

## How

Captured headlessly, so the set stays consistent and anyone can reproduce it.
Playwright is deliberately **not** a dependency of this project — install it
outside the repo and run it from there, so `package.json` keeps its two runtime
and one dev dependency.

```bash
npm run seed && npm start            # demo data, then leave it running

mkdir -p /tmp/pw && cd /tmp/pw       # anywhere outside the repo
npm init -y && npm install playwright
npx playwright install chromium
```

Then a script in `/tmp/pw` that, for each surface:

- opens a context at **1920 × 964, deviceScaleFactor 2** (the files are
  3840 × 1928; match it or the set stops looking like one thing)
- appends `?lang=en` to every URL, so the whole set is one language regardless
  of what the browser would negotiate
- signs in as `organizer@example.com` / `demo-password-1234` for `/admin`
- signs in as `entrant@example.com` / `entrant-password-1234` for
  `/enter/<slug>`, in a second context so the two sessions do not collide.
  `npm run seed` creates that participant, opens the submission window, and
  attributes two of the twelve entries to them, so every frame here is
  reproducible without hand-editing the database
- goes to `/admin/c/<competition-id>/<tab>` directly, where the tab is one of
  `setup rubric entries judges results`
- scrolls the section card to the top before shooting the rubric, judges and
  results tabs, so the whole panel fits in one frame; `entries` is shot from the
  top of the page, header and tabs included
- shoots `/j/<token>` and `/board/<slug>` from a second, anonymous context

`/sysadmin` needs the platform role. Rather than using a real administrator
account, promote the demo organizer for the capture and revoke it afterwards —
the screenshot then reads *Signed in as Demo Organizer* instead of a real name:

```bash
npm run promote -- organizer@example.com
# capture
npm run promote -- organizer@example.com --revoke
```

The Setup tab is long, so `admin-submissions.png` scrolls to the
**Participant submissions** card the same way the rubric and judges frames do.

Headless capture lands at **204–351 KB** per file, about 1.8 MB for the set, with
no optimiser run over it. If a capture comes out much heavier than that, it was
probably taken as a window screenshot rather than headlessly.

Update **both** `README.md` and `README-ja.md` when you add or replace an image —
each embeds the same files with its own caption, and the alt text is translated
too. Several captions cite specific numbers visible in the image (the rubric
weights summing to 60, sponsor judges at 5/9 and 4/7, rank 4 at five of five
judges); if a recapture changes what is in frame, fix the caption with it.

## Before committing

**The seed data is fake, which is the point.** If you capture from a real event
instead, redact every one of these:

- **judge links and tokens, including the browser address bar.** A `/j/<token>`
  URL in a screenshot is a working credential. The address bar is the one people
  forget; the in-page link fields happen to be too narrow to show the token, but
  do not rely on that.
- judge names and per-judge scores
- feedback notes
- real participant, team and sponsor names
- organizer e-mail addresses
- absolute paths and hostnames that identify your deployment

Screenshots of the real interface are always fine to publish elsewhere too — see
[BRAND.md § 7](../brand/BRAND.md#7-screenshots-and-press). Do not crop the logo
out of one and reuse it as a mark.
