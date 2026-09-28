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
| Mark | [`logo/judgium-mark.png`](logo/judgium-mark.png) | Favicons, avatars, app icons, the header |
| Wordmark | [`logo/judgium-wordmark.svg`](logo/judgium-wordmark.svg) | Headers, README, slides, anywhere the name must read |

The mark is a white **J** in a solid blue disc, with a scatter of squares
dissolving off the upper-left edge — a letterform coming apart into pixels, or
assembling out of them. At 32 px the disc and the letter carry it; the scattered
squares reduce to a faint texture, which is expected and does not hurt
legibility.

The wordmark embeds the mark as a data URI, so it is one self-contained file
with no external reference.

**Wanted: a vector master.** Everything here derives from a 460 × 460 PNG, which
is enough for every current use but caps how large the mark can be drawn and
rules out a true single-colour version. If the original vector exists, an SVG
export would replace `judgium-mark.png` and allow:

- a monochrome mark that inherits `currentColor` for single-colour contexts
- print and large-format use
- a favicon measured in hundreds of bytes rather than kilobytes

The served copies in `public/brand/` are resized from the same master.

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
| Judgium Blue | — | `#2882fc` | The mark's disc. The one colour that identifies us, and the only place this exact value is used. |
| Action blue | `--accent` | `#2766bc` | The interface: button fills, focus rings, selected states |
| Link blue | `--accent-strong` | `#245495` | Link and accent text |
| Deep blue | `--accent-deep` | `#1a4074` | Badge and rank fills that carry white text |
| Tint | `--accent-soft` | `#e9f2fe` | Quiet backgrounds behind accent text |
| Ink | — | `#0a1d36` | Wordmark text, and text on light accent fills in dark mode |

**The interface is deliberately a shade deeper than the mark.** Judgium Blue is
vivid, which is right for a logo and wrong for a button: white text on
`#2882fc` reaches only 3.69:1, below the 4.5:1 that WCAG AA asks for. The
interface palette keeps the mark's hue (215°) and drops the lightness until
every real pairing passes — white on `--accent` is 5.66:1, link text on the
page background is 7.10:1, white on `--accent-deep` is 10.35:1. All twelve
foreground/background pairs that actually occur in `public/css/app.css` were
measured; the lowest is 5.47:1.

So: **the mark uses `#2882fc` and nothing else does.** Do not sample the disc
and use it for text or a button.

The dark theme lifts the same hue instead of dropping it (`--accent` becomes
`#5c9df4`), which is why the mark reads correctly on both themes without a
second asset.

The rest of `public/css/app.css` is free to change under AGPL-3.0. Judgium Blue
is not — it is part of the mark.

## 4. Using the mark in a deployment

**You may display the unmodified mark on an unmodified build.** If you run
Judgium as released — no changes to the source — you may leave the favicon and
the header brand exactly as shipped. That is the normal case for a self-hosted
instance, and it needs no permission: the mark is telling the truth about what
the software is.

**You must replace the mark if you changed the code**, or if you host the
instance for other people under your own service name. Replace `public/brand/`
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
