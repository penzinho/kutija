# Narodni Maksimir: development plan

Working plan we go through together, one step at a time. The commit rule from CLAUDE.md still applies: commit after each completed step.

Sources:
- `SPEC.md`: product, voting model, Supabase schema.
- `entries.json`: the final content (88 entries from the jury report).
- `entries/`: 88 renders (`<id>-1.jpg`, about 1600×1010, 30 MB).
- `Narodni Maksimir prototype/`: the high-fidelity design (`Narodni-Maksimir.dc.html`, `tokens.css`, `HANDOFF.md`, `design_handoff_narodni_maksimir/`).

SPEC.md was written before the real data and the design arrived. Parts of it are now out of date, so this plan wins wherever the two disagree. The decisions below settle the conflicts.

---

## 0. Decisions

✅ = confirmed. All decisions were confirmed on 2026-09-25. For D6 we use the hybrid pairing below.

| # | Topic | SPEC says | Design / data says | Proposed |
|---|---|---|---|---|
| ✅ D1 | Awarded ids | ids 1–5 are the awards; 6–88 placeholders | Real `entries.json`: awards are **16 (1st), 62 (2nd), 37 (3rd), 3 (4th), 33 (5th)** | Use the real `entries.json` as-is. Drop the "seed 1–5" instruction. Fix design copy that assumes 1–5. |
| ✅ D2 | Data shape | flat `Entry[]` with `sourceUrl` | `{ meta, entries[] }` with status, round, descriptions, jury text | Zod schema matches the real file. `sourceUrl` comes from `meta`. |
| ✅ D3 | Images | arrive later → placeholders; 16:9 | 88 renders already in `entries/`; card is 4:3, detail is 16:10 | The images are already in `entries/`; import them in step 2. Keep the design aspect ratios with `object-fit: cover`. Keep the gradient placeholder only as a fallback. |
| ✅ D4 | Styling | minimal, structural; design comes later | High-fidelity design is ready | Build straight to the design. Replace the placeholder `tokens.css` with the design `tokens.css`. |
| ✅ D5 | Elo K | 32 | 24 | **32** (SPEC; faster convergence with few voters). |
| ✅ D6 | Pairing | fewest duels first, avoid repeats, random | random A, then B from the 14 nearest by Elo | Hybrid: A = weighted toward fewest duels; B = random from the ~14 nearest by Elo, excluding self, excluded entries, and pairs already judged. `/dvoboj?a=id` pins A. |
| ✅ D7 | Backend API | Supabase Edge Function `vote` + RPC | `/api/vote`, `/api/rank`, `/api/count` | Supabase (SPEC). The edge function `vote` handles `get_pair`, `vote_duel`, `set_favorite`. Reads (leaderboard, count) go through the public view via supabase-js. |
| ✅ D8 | Rate-limit UX | 1 duel / 1.5 s server-side | banner after 7 votes / 5 s | Server limits as in SPEC. Any 429 shows the design banner with a countdown taken from the response (`retry_after`). |
| ✅ D9 | Favorites | one per session | "Moji favoriti" filter, `fav: number[]` in localStorage | **One favorite** (SPEC). The "Moji favoriti" chip shows that entry. localStorage keeps only the UI mirror (`nm-v1`). |
| ✅ D10 | 24h rank delta (▲▼) | not in SPEC | used in rank chip + leaderboard | Add a `rank_snapshots` table, filled by a daily `pg_cron` job (free tier). Show "—" until the first snapshot exists. |
| ✅ D11 | Live counter | not in SPEC | ticks ~1.1 s | Poll a cheap `stats` view (total duels) every ~5 s while the tab is visible. The user's own vote adds +1 immediately. No Realtime needed. |
| ✅ D12 | Share Top 3 | `/?top=12,5,40`, share after 10 duels | modal after every 10th duel; OG at `/og/top3?ids=` | Share URL `/?top=…` (static). A dynamic per-share OG image needs a serverless function, so use a static generic OG for now and decide later (see D14). |
| ✅ D13 | EN toggle | optional | not designed | **Croatian only.** The EN fields stay in the data but are not shown. |
| ✅ D14 | Hosting cost | Vercel | — | **Free tiers only:** Vercel Hobby + Supabase Free + Turnstile Free = €0. **Ask before** anything that needs Pro (e.g. heavy image optimization, serverless OG at scale). Note: Vercel Hobby is non-commercial only. |
| ✅ D15 | Git | commit after each step | `kutija/` is currently an untracked folder inside the `~/Documents/DEV` repo | **You create the repo** for `kutija/` (needed for Vercel anyway). I commit into it after each step. |
| ✅ D16 | Missing content | — | authors known only for the 5 awarded; country for 3; no PDF for the others | **We will research the authors** and add them to `entries.json` (step 10a). Until then, show "Autori nisu objavljeni", hide empty fields, and link the PDF only where one exists. |

---

## Steps

### 1. Scaffold
- [x] (you) create the git repo for `kutija/`; I add `.gitignore` (D15)
- [x] `pnpm create astro` (minimal, TS strict), set `output: 'static'`, add the Vercel adapter only if a later step needs it
- [x] Add Preact integration (for islands), zod, `@fontsource` for Anton, Schibsted Grotesk and JetBrains Mono
- [x] Copy the design `tokens.css` to `src/styles/tokens.css`
- [x] Move `entries.json` to `src/data/entries.json`; `src/data/entries.ts` = zod schema + typed helpers (`getEntry`, `awarded`, `duelEligible`, `statusLabel`)
- [x] `Base.astro`: fonts, tokens, header/nav, footer disclaimer, mobile tab bar (<760px), grain overlay, `<ClientRouter />`, SEO/OG props
- [x] `.env.example`
- ✅ Done when: `pnpm build` passes and the zod validation fails the build on bad data

### 2. Images
- [x] `scripts/import-images.ts <folder>`: reads `<id>-<n>.jpg`, writes optimized files to `src/assets/entries/` (so `astro:assets` makes AVIF/WebP + srcset), fills `images[]` in entries.json
- [x] Run it on `entries/`; move the originals out of the repo or gitignore them (30 MB)
- [x] Alt text = `Rad {id} · {code} · {authors}`
- ✅ Done when: all 88 entries have `images[0]`; the build output per image is reasonable (< ~150 KB for the card size)

### 3. Static pages (no backend yet; ranks and counts are mocked from a local stub)
- [x] Components: `EntryCard`, `AwardBadge`, `StatusBadge` ("Ispao u X. krugu" / "Finalist" / excluded), `RankChip`, `Footer`, `TabBar`
- [x] `/`: hero (headline, CTAs, scoreboard, card stack), marquee, grid, sticky `FilterBar` island (Svi / Nagrađeni / Ostali / Moji favoriti + counts; sort Po broju / Po narodnom rangu), awarded cards 2×2, `?top=` renders the "Moj top 3" block
- [x] `/rad/[id]`: gallery, aside (number, badge, code, authors, country, PDF), description, jury text, round note, Žiri vs Narod box, stats row, favorite + "Usporedi u dvoboju" buttons, prev/next, view-transition morph
- [x] `/o-projektu`: disclaimer, 4 blocks, placeholder takedown email
- [x] Motion + reduced motion per the SPECS table (scroll reveal, tilt, grid re-stagger); pause intervals when `document.hidden`
- ✅ Done when: all pages match the reference at 1440px and 390px, keyboard focus works, and the Lighthouse mobile score on `/` is ≥ 90

### 4. Supabase database
- [ ] `supabase init`; migrations: `entries` (seeded 1..88, with an `eligible` flag false for 56/87/88), `duels`, `favorites`, `pair_tokens`, `rank_snapshots` (D10)
- [ ] RLS on everything; clients may only SELECT `leaderboard` and `stats`
- [ ] SECURITY DEFINER functions: `get_pair(session, ip_hash, pin?)`, `vote_duel(token, winner, session, ip_hash)` (row locks, Elo K=32, delete token), `set_favorite(entry, session, ip_hash)`, `recompute_elo()`, `snapshot_ranks()`
- [ ] Rate limits inside the functions: 1 per 1.5 s, 300 per day per session, 1000 per day per IP hash, 5 favorites per day per IP hash; errors return a typed code plus `retry_after`
- [ ] Views: `leaderboard` (id, elo, rank, rank_24h, duels, wins, favorites; non-excluded rows only), `stats` (total duels, voters today)
- [ ] `supabase/tests/voting.sql`: Elo math, rate limit, invalid or expired token, wrong session, duplicate pair, excluded entry never paired
- ✅ Done when: `pnpm dlx supabase db reset` passes and the SQL tests pass locally

### 5. Edge Function `vote` + session
- [ ] `supabase/functions/vote`: verify the JWT (anonymous user), take the IP from `x-forwarded-for`, `ip_hash` = sha256(ip + daily salt derived from `IP_HASH_SALT_SECRET`), route `get_pair` / `vote_duel` / `set_favorite` to the service-role RPC, set CORS
- [ ] Client `src/lib/session.ts`: lazy anonymous sign-in with the Turnstile token (invisible widget), only when the visitor first interacts with voting, so page views set no session
- [ ] Enable anonymous sign-ins + Turnstile captcha in the Supabase dashboard (documented in the README)
- ✅ Done when: a local `functions serve` round trip works (get pair → vote → Elo changes; a replayed token is rejected)

### 6. Duel island (`/dvoboj`)
- [ ] Two cards + VS; tap / ← → to vote, Space / ↓ to skip; prefetch the next pair
- [ ] Win FX (stamp, flash, ≤34 confetti bits), next pair slides in after 720 ms (250 ms with reduced motion)
- [ ] Progress "Odigrao si X dvoboja" + 10 segments; success pill; rate-limit banner with countdown; error/empty states
- [ ] `?a=id` pins one side; localStorage `nm-v1` mirrors `played` and `userWins`
- ✅ Done when: 20 duels in a row are smooth on mobile and nothing breaks when offline or rate-limited

### 7. Leaderboard + favorites + live data
- [ ] `/rang`: Žiri vs Narod hero, "Najveća neslaganja" cards (1–88 track with Ž/N markers), top-20 table + "Prikaži svih 88", FLIP on rank change; highlight rows where the people disagree with the jury
- [ ] Jury order for the comparison: award 1–5 → finalists → eliminated by round reached (6 → 1); excluded entries go last and are not ranked
- [ ] Replace the step-3 stubs: ranks on the grid and detail page, favorite toggle via `set_favorite`, live counter poll (D11)
- ✅ Done when: votes in one tab show up in `/rang` in another tab within ~5 s

### 8. Share, SEO, OG
- [ ] "Moj top 3" modal after every 10th duel (user wins, padded with the people's top entries) → copy/share `/?top=a,b,c`
- [ ] Per-page title/description/OG; build-time per-entry OG images with satori (`/og/rad/[id].png`)
- [ ] Decide D12/D14 on dynamic top-3 OG images
- ✅ Done when: OG previews are correct (checked with a debugger tool) for `/`, `/rad/16`, `/?top=…`

### 9. Moderation tooling
- [ ] `scripts/flag-suspicious.sql`: sessions/IP hashes with >90% votes for one entry, bursts, and too many sessions per IP; helper to set `excluded`
- [ ] `recompute_elo()` wired into the flow after flagging; document the procedure in the README
- ✅ Done when: a seeded abusive session is flagged, excluded, and after a recompute its effect is gone from `leaderboard`

### 10a. Authors research (D16)
- [ ] Find authors (and country where known) for the non-awarded entries: announcements, architects' own sites and portfolios, press; record a source for each
- [ ] Add them to `entries.json` (zod still validates); the "Autori nisu objavljeni" fallback stays for entries we can't confirm
- ✅ Done when: every author we add has a source, and nothing is guessed

### 10. Launch
- [ ] README: Supabase project, anonymous + Turnstile setup, migrations, secrets, function deploy, Vercel env and deploy
- [ ] Create the Supabase cloud project + Turnstile site key + Vercel project (**confirm the free tiers with you first**)
- [ ] Fill in the bracketed placeholders on O projektu (author, takedown email)
- [ ] Final checks: Lighthouse, keyboard-only pass, reduced-motion pass, no cookies beyond the Supabase session, no analytics
- ✅ Done when: production URL is live and one real vote works end to end

---

## Out of scope for v1
EN language toggle · accounts / login (never) · analytics · Realtime push · admin UI (SQL only).
