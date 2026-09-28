# Judgium Brand Guidelines

Everything in `docs/brand/` — this document and every file under `logo/` —
is **excluded from the AGPL-3.0 licence that covers the source code.** See
[`LICENSE-BRAND`](LICENSE-BRAND) in this directory for the terms, and
[`TRADEMARKS.md`](../../TRADEMARKS.md) for what you may and may not do with the
name.

These guidelines exist so that the official project looks consistent, and so
that anyone who has permission to show our mark knows how to show it properly.

---

## 1. The marks

| Asset | File | Use it for |
|---|---|---|
| Mark | [`logo/judgium-mark.svg`](logo/judgium-mark.svg) | Favicons, avatars, app icons, anywhere under 48 px |
| Mark, monochrome | [`logo/judgium-mark-mono.svg`](logo/judgium-mark-mono.svg) | Single-colour contexts; inherits `currentColor` |
| Wordmark | [`logo/judgium-wordmark.svg`](logo/judgium-wordmark.svg) | Headers, README, slides, anywhere the name must read |

The mark is three ascending bars — a podium and a bar chart at once: entries
ranked, scores accumulating. It reads at 16 px, which is why the favicon and the
logo are the same file.

SVG is the only format we ship. Raster it yourself at the size you need; do not
ship a PNG you scaled up from a small one.

## 2. Name

**Judgium.** One word, capital J, everything else lower case. Never:

```
❌  judgium (in prose)   ❌  JUDGIUM      ❌  JudgIum
❌  Judgium.io           ❌  Judgium App  ❌  "the Judgium"
```

It is a proper noun, so it takes no article: "Judgium computes the leaderboard",
not "the Judgium computes…". In Japanese: **ジャッジアム**, and the Latin spelling
is preferred in technical writing.

Pronounced *JUJ-ih-um* — *judge* + *-ium*, read two ways at once: a place
where judging happens, and an element on the periodic table.

**Tagline.** *Every challenge conveyed fairly — where projects and judging
meet.* / *挑戦を、正しく届ける、作品と評価が出会う場所。*
Use it beneath the wordmark or not at all; never inside a sentence.

## 3. Colour

| Role | Token | Hex | Notes |
|---|---|---|---|
| Judgium Purple | `--brand` | `#7c4fc2` | The mark's field. The one colour that identifies us. |
| Ink | `--ink` | `#1b1230` | Wordmark text on light backgrounds |
| Paper | `--paper` | `#ffffff` | Bars inside the mark; never tint them |

Judgium Purple on white is 4.6:1 — it passes AA for text at any size, so the
wordmark needs no special handling. On dark backgrounds use the wordmark with
`#ffffff` text rather than lightening the purple; the field stays the same
purple in both themes, which is what makes it recognisable.

The application's full palette lives in `public/css/app.css` and is free to
change under AGPL-3.0. These three values are not — they are part of the mark.

## 4. Using the mark in a deployment

**You may display the unmodified mark on an unmodified build.** If you run
Judgium as released — no changes to the source — you may leave the favicon and
the header brand exactly as shipped. That is the normal case for a self-hosted
instance, and it needs no permission: the mark is telling the truth about what
the software is.

**You must replace the mark if you changed the code**, or if you host the
instance for other people under your own service name. Swap `public/favicon.svg`
and the `topbar__brand` text, and delete `docs/brand/` from your tree. See
[TRADEMARKS.md § 4](../../TRADEMARKS.md#4-forks-must-be-renamed) for the full
rename checklist.

Adding your event's own logo *beside* ours on a leaderboard screen is fine —
the two must not be combined into one lock-up.

## 5. Clear space and minimum size

Keep clear space equal to the mark's corner radius (⅛ of its width) on all four
sides. Nothing — no text, no border, no other logo — inside that margin.

```
    ┌─────────────────────┐
    │   ┌─────────────┐   │   clear space = 1/8 × width
    │   │  ▁ ▄ ▂      │   │
    │   │  Judgium    │   │   min:  mark      16 px
    │   └─────────────┘   │        wordmark  88 px
    └─────────────────────┘
```

Below the minimum, use the mark alone; below 16 px, use nothing.

## 6. Do not

- **Recolour** the field, or tint the bars.
- **Redraw, restyle or re-proportion** — no outlines, gradients, shadows,
  bevels, glows, 3-D, animation, or stretching to a different aspect ratio.
- **Rotate or skew.** The bars ascend left to right; that is the meaning.
- **Set the wordmark in another typeface,** or letter-space it differently.
- **Combine** our mark with another logo, icon, emoji or text into a single
  composite, badge, seal or ribbon.
- **Use it as your own** avatar, app icon, favicon, or the face of your fork.
- **Place it on a busy photo** or a background that drops contrast below 3:1.
- **Put it in a sentence.** The word "Judgium" goes in prose; the logo does not.

## 7. Screenshots and press

Screenshots of the real interface are always fine — in articles, reviews,
tutorials, comparisons and slides — including screenshots that show the mark,
because that is what the screen looks like. No permission, no attribution
beyond the [TRADEMARKS.md § 2](../../TRADEMARKS.md#2-nominative-use--always-permitted)
line.

Do not crop the mark out of a screenshot and reuse it as a logo. That is § 6.

## 8. Asking

Anything not covered above: open a
[Discussion](https://github.com/judgium/judgium/discussions) with what you want
to do, where it would appear, and a mock-up. We answer within 30 days.

---

*Judgium Brand Guidelines v1.0 — 2026-09-28.*
