# Screenshots

The README's **Screens** section renders the files in this directory. They are
not committed yet — capture them once and they stop being a chore.

## What to capture

Run `npm run seed` first: it builds a demo hackathon with 12 entries and 5
judges and prints every link, so the screens have realistic data in them rather
than empty states.

| File | Page | Show |
|---|---|---|
| `admin-entries.png` | `/admin` → Entries | A dozen entries with tracks and table numbers |
| `admin-rubric.png` | `/admin` → Rubric | Weighted mode, percentages visible and summing to 100 |
| `judge-scorecard.png` | `/j/<token>` | One entry, a criterion part-filled, the feedback box, prev/next |
| `board.png` | `/board/<slug>` | Top 8 with ranks, at least one tie, `judgesScored / judgesEligible` visible |
| `sysadmin-overview.png` | `/sysadmin` | The counters and the storage/durability panel |

## How

1. `npm run seed && npm start`
2. Score a few entries from two or three judge links, so the board has real
   ranks and at least one tie.
3. Capture at **1440 × 900**, 2× DPI, in light theme. The interface is
   mobile-first and works at phone width; one narrow capture of the judge
   scorecard is worth adding as `judge-scorecard-mobile.png`.
4. Optimise (`oxipng -o4`, or `pngquant --quality=80-95`). Keep each file under
   300 KB — the README is the first thing anyone loads.

## Before committing

**The seed data is fake, which is the point.** If you capture from a real event
instead, redact every one of these:

- judge links and tokens in the URL bar — a `/j/<token>` URL in a screenshot is
  a working credential, and the address bar is easy to forget
- judge names and per-judge scores
- feedback notes
- real participant, team and sponsor names
- organizer e-mail addresses

Screenshots of the real interface are always fine to publish elsewhere too — see
[BRAND.md § 7](../brand/BRAND.md#7-screenshots-and-press). Do not crop the logo
out of one and reuse it as a mark.
