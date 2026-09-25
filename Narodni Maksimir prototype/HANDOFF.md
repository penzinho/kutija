# Narodni Maksimir — handoff

Source of truth: `tokens.css` (import once in the Astro base layout). All values below reference its variables. Live reference: `Narodni-Maksimir.dc.html` (routes `#/`, `#/rad/2`, `#/dvoboj`, `#/rang`, `#/o-projektu`, `#/komponente`).

Breakpoint: **mobile < 760px**. Mobile = bottom tab bar (`--tabbar-h`) and no top-nav links. Everything else is fluid (clamp / auto-fit grids).

## Components

**Entry card** (`/` grid)
- Grid: `repeat(auto-fill, minmax(clamp(150px,22vw,290px),1fr))`, gap `clamp(10px,1.6vw,20px)`, `grid-auto-flow: dense`. On a phone that gives 2 columns; on desktop, 4.
- Anatomy: image area (4:3), with the entry number (display 34px) top-left, the award badge top-right and a mono "RENDER STIŽE" label bottom-left. Below the image: a meta row with the code (mono 11) and a rank chip.
- States:
  - default: border `--c-line`.
  - hover/focus: 3D tilt (max ±6°/±8°), translateY(-4px), glow shadow, image scale(1.07). A reveal panel slides up from the bottom (`--c-blue-600` at 94%) with "Pogledaj rad →" and the people's rank + rating.
  - awarded: spans 2×2 on desktop (2×1 at 16:10 on mobile), number at 64px, border `rgba(160,200,255,.3)`.
  - image-missing: diagonal stripes on `--c-navy-900` with the label "SLIKA NIJE DOSTUPNA".
  - pending render: generated "stadium-bowl" gradient from the entry seed. Once a real image arrives, replace the background with `background-image` + `object-fit: cover`.
  - skeleton: shimmer at 1.4s linear.
- Tap: shared-element morph into the detail page (see Motion).

**Award badge**: pill with a display numeral and the text "nagrada žirija". Tier colours are `--award-{1..5}-bg/fg/bd`: tiers 1–3 are solid, lightening down the blue ladder; tiers 4–5 are outline only.

**Rank chip**: mono, "Narod #N", followed by ▲n (`--c-up`) / ▼n (`--c-down`) / — (no change) against the 24h baseline.

**Filter chips**: Svi / Nagrađeni / Ostali / Moji favoriti, each with a count. Active chip: `--c-ink` background with navy text. Inactive: transparent with a `--c-line-strong` border. The filter bar is sticky under the nav and scrolls horizontally on mobile.

**Sort control**: segmented pill; the active segment is `--c-blue-600`. Labels are "Po broju" and "Po narodnom rangu" ("Po rangu" on mobile).

**Live counter**: a digit reel per character, in the display font. Each digit is a 0–9 vertical strip translated by `-n × 1.1em`. It ticks every ~1.1s (server push or poll in production), and the user's own vote adds +1 immediately.

**Duel card**: states are idle / hover (translateY(-6px), ring at 55% blue) / chosen (scale 1.035, `--sh-glow`, accent ring, "POBJEDA" stamp rotated -8°) / loser (scale .94, grayscale .85, brightness .55, opacity .75). The VS badge sits centred between the two cards (between them when stacked on mobile).

**Skip**: secondary pill, minimum 44px tall. Keyboard: Space / ↓.

**Vote success**: a "Glas zabilježen · Rad NN" pill fades in and out over 1.5s, plus the win FX.

**Error (rate limit)**: after more than 7 votes in 5s, show the banner "Previše glasova, pričekaj trenutak" with a countdown. It uses a `--c-danger` border on a 10% tint, and the cards stay disabled until the countdown ends.

**Empty state**: an outlined "0" numeral, a title, one line of help text and the CTA "Kreni glasati".

**Leaderboard row**: columns are Narod rank (reel) · 24h delta · thumbnail + Rad + code · Žiri · Ocjena · Dvoboji · Favoriti · Pobjede. Mobile shows three columns: rank, entry, and rating + delta. Awarded rows get a 20% `--c-blue-600` tint.

**Share card**: 1200×630 (OG), shown scaled in the modal. It opens after every 10th duel. The Top 3 comes from the user's wins, padded with the people's top entries if needed. Production: render server-side (satori / @vercel/og) at `/og/top3?ids=`.

## Motion

| What | Trigger | Duration | Easing |
|---|---|---|---|
| Floodlight sweep (2 conic beams) | ambient, alternate | 14s / 17s | `--ease-in-out` |
| Hero card stack (8 cards, 4 visible) | every 3.2s; front card exits left | `--dur-hero` 900ms | `--ease-out` |
| Hero parallax | pointer move | 700ms follow | `--ease-out` |
| Marquee band | ambient | 38s linear | — |
| Scroll reveal (fade + 28px rise) | IntersectionObserver, once | 640ms + 70ms × index | `--ease-out` |
| Grid re-stagger | filter / sort change | 420ms + 35ms × i (first 16 only) | `--ease-out` |
| Card tilt / lift | hover | `--dur-base` 260ms | `--ease-out` |
| Image zoom | hover | `--dur-slow` 480ms | `--ease-out` |
| Card → detail morph | card tap | `--dur-morph` 560ms, then 180ms fade | `--ease-out` |
| Duel win: chosen scale / loser dim | vote | 420ms | `--ease-spring` |
| Win flash + 34 confetti bits | vote | 520ms / 900–1400ms | ease-out |
| VS pulse | vote | 440ms | `--ease-spring` |
| Next pair slides in (±70px X; ±30px Y on mobile) | 720ms after vote, or skip | 420ms | `--ease-out` |
| Flip-digit reels (counter, ranks, duels played) | value change | `--dur-reel` 700ms | `--ease-snap` |
| Leaderboard FLIP + blue flash | rank change | 760ms | `--ease-out` |

**Reduced motion** (`prefers-reduced-motion`, or the site's calm toggle):
- Ambient loops, the hero cycle, tilt, confetti, reveals and the morph are all off.
- Durations collapse to 1ms. Reels jump straight to the value; state changes (chosen / loser) still apply.
- The pause before the next duel pair drops to 250ms.

**Performance**:
- Animate only `transform` and `opacity`, plus the CSS gradient backgrounds.
- No WebGL.
- Confetti is at most 34 DOM nodes, removed when finished.
- Pause the intervals when `document.hidden`.

## Content notes
- Entries 1–5 are the jury prizes. Their codes are 6TVJ3MUHR, GY0F1A9OM, W3YS5VJBZ, 6PPWVBBBZ, CYFXC7LIM.
- The other codes, and all authors, countries and ratings, are placeholder data.
- No club crest or official logos anywhere. The disclaimer is on /o-projektu, with a short version in the footer.
