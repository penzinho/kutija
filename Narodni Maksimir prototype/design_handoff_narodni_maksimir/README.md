# Handoff: Narodni Maksimir — people's vote for the new Maksimir stadium

## Overview
This is an unofficial site for fans to vote on the new Maksimir stadium.
- Fans browse all 88 competition entries.
- They vote through head-to-head duels.
- They compare the people's ranking with the jury's awards.
- The UI is in Croatian and designed for phones first.

## About the design files
`reference/Narodni-Maksimir.dc.html` is an **HTML design reference**, not production code.
- It shows how the site should look and behave.
- Recreate it in **Astro**. Use islands, for example Preact or Svelte, only where the page needs interaction.
- To view it, open it in a browser. `support.js` must stay next to it. Serve the folder locally with `npx serve reference` so the hash routes work.
- Routes in the reference: `#/`, `#/rad/2`, `#/dvoboj`, `#/rang`, `#/o-projektu`, and `#/komponente` (a sheet showing every component state).

## Fidelity
**High-fidelity.** Match the colours, type, spacing and motion exactly. Every value is in `tokens.css`.

## Files
- `tokens.css`: the single source of truth for design values. Import it once in `src/layouts/Base.astro`. It includes the reduced-motion overrides.
- `SPECS.md`: component states and the full motion table (duration, easing, trigger). **Read this before building.**
- `reference/`: the live prototype.

## Suggested Astro structure
```
src/
  styles/tokens.css
  layouts/Base.astro        # fonts, tokens, header, footer, mobile tab bar, grain overlay
  pages/index.astro         # hero + grid
  pages/rad/[id].astro      # getStaticPaths for ids 1–88
  pages/dvoboj.astro        # <Duel client:load />
  pages/rang.astro          # <Leaderboard client:visible />
  pages/o-projektu.astro
  components/EntryCard.astro, AwardBadge.astro, RankChip.astro, FilterBar (island),
             LiveCounter (island), HeroStack (island), Duel (island), ShareCard, Leaderboard (island)
  data/entries.json         # id, code, award (0–5), authors, country, images[], pdfUrl
```
- Use Astro View Transitions (`<ClientRouter />`) for the card-to-detail morph. Put `transition:name={`entry-${id}`}` on both the card image and the detail hero image.
- Fonts: Anton, Schibsted Grotesk and JetBrains Mono, all from Google Fonts. All three support č ć đ š ž. Self-hosting them with `@fontsource` is fine.

## Screens
1. **Početna (`/`)**
   - Full-height hero with two sweeping floodlight beams, a giant outlined "NAROD" behind the content, and a pitch-line circle.
   - Left column: kicker, h1 ("Žiri je odlučio." / "Sad je red / na narodu."), lead text, the CTAs "Kreni glasati" and "Pregledaj radove", and a live scoreboard.
   - Right column: a 3D-tilted stack of 8 cards (4 visible) that cycles every 3.2s.
   - Below the hero: a blue marquee band, then the grid with a sticky filter and sort bar.
2. **Rad (`/rad/[id]`)**
   - Gallery: 16:10 main image with 4 thumbnails.
   - Aside: giant number, award badge or "Bez nagrade žirija", code chip, authors, country, PDF link, and a Žiri VS Narod scoreboard.
   - Stats row: 4 cells.
   - Buttons: "Ovo je moj favorit" (toggle) and "Usporedi u dvoboju" (goes to `/dvoboj?a=id`).
   - Previous and next arrows.
3. **Dvoboj (`/dvoboj`)**
   - Title and progress: "Odigrao si X dvoboja" with 10 segments.
   - Two cards with a VS badge; they stack on mobile.
   - ←/→ keys vote; Space skips.
   - Win sequence: stamp, flash and confetti, then the next pair slides in after 720ms.
   - Every 10th duel opens the "Moj top 3" share modal.
   - Rate-limit banner.
4. **Rang (`/rang`)**
   - Jury pick vs people's #1 hero split.
   - "Najveća neslaganja": cards for the awarded entries, each with a 1–88 track showing the Ž and N markers.
   - Table: top 20, with "Prikaži svih 88". Rows animate with FLIP when ranks change.
5. **O projektu**
   - Headline and lead text.
   - "NESLUŽBENO" disclaimer box.
   - 4 numbered blocks: Kako se glasa, Izvori, Tko stoji iza, Uklanjanje sadržaja.

**Footer on every page:** "Neslužbena stranica. Autorska prava na radove pripadaju autorima." plus the source link.

**Mobile (<760px):** fixed bottom tab bar (Radovi, Dvoboj, Rang, O projektu), 68px tall. Top-nav links are hidden.

## State and data
- **Server**
  - `POST /api/vote {winner, loser}` updates Elo with K=24. Return 429 to trigger the "Previše glasova, pričekaj trenutak" banner.
  - `GET /api/rank` returns `{id, elo, rank, rank24h, duels, wins, favs}`.
  - `GET /api/count` supplies the live counter. Poll it or use SSE.
  - Candidate stores: Cloudflare D1/KV or Supabase.
- **Pairing:** pick A at random, then pick B at random from the 14 entries closest to A's Elo.
- **Client (localStorage `nm-v1`):** `{fav: number[], played: number, userWins: {id: count}}`.
- **Share image:** render the 1200×630 OG image with `@vercel/og` or satori at `/og/top3?ids=`.

## Assets
- No images yet. Every render is a generated placeholder, a CSS gradient seeded per entry. Replace it with real renders from `entries.json`.
- There are no logos or crests, and none should be added.
- The only symbols are text glyphs: ✶ ★ ▲ ▼ ← →.

## Content
- Entries 1–5 are the jury's 1st–5th prizes. Their codes are 6TVJ3MUHR, GY0F1A9OM, W3YS5VJBZ, 6PPWVBBBZ and CYFXC7LIM.
- All other codes, and all authors, countries and ratings, are placeholders.
- Bracketed text on O projektu, such as `[Ime autora]`, must be filled in before launch.
