# Screenshots

The images the README's **Screens** section renders. All captures come from the
demo data `npm run seed` builds, so nothing in them is real.

## What is here

The set is complete. `README.md` and `README-ja.md` embed all seven in the order
an event runs, not in the order below.

| File | Page | Shows |
|---|---|---|
| `admin-entries.png` | `/admin` → Entries | 12 projects with team, track and table |
| `admin-rubric.png` | `/admin` → Rubric | Weighted mode, 25/20/20/15/10/10 |
| `admin-judges.png` | `/admin` → Judges | Private links, progress, rotate/reopen/clear |
| `judge-scorecard.png` | `/j/<token>` | A submitted card: entry chips, per-criterion fields, prev/next |
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
- **`judge-scorecard-partial.png`** — a card mid-scoring, with **Mark as
  complete** rather than **Reopen my scorecard**, and the feedback box in frame.

## How

1. `npm run seed && npm start`. Seeding gives twelve entries and five judges
   with realistic names, so the screens are not full of empty states.
2. Score a few entries from two or three of the judge links it prints, so the
   board has real ranks and at least one tie.
3. Capture at 2× DPI in light theme. The existing files are 3840 × 1928, which
   is 1920 × 964 at 2×; matching that keeps the set consistent.
4. Optimise losslessly (`oxipng -o4`, or `pngquant --quality=80-95` if you
   accept a lossy step). The current files are 430–630 KB each at 2× full width.
   Anything under roughly 700 KB is fine; if a capture comes out much larger
   than its neighbours, it has not been optimised.

Update **both** `README.md` and `README-ja.md` when you add or replace an image —
each embeds the same files with its own caption, and the alt text is
translated too.

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
