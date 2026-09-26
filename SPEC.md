# Project: "Narodni Maksimir" — public gallery + voting for all 88 Maksimir stadium competition entries

## Context
The international architecture competition for the new Maksimir stadium (SRC Svetice) received 88 entries. Only the 5 awarded entries are officially published. The jury's winner is getting heavy public backlash. This site lets people browse all entries in one place and vote on which is best — a "people's choice" vs the jury.

Build the SKELETON now: data model, pages, voting logic, leaderboard. Images come later and design comes later (from Claude Design), so:
- Keep styling minimal and structural (layout, spacing, responsive grid). No design decisions baked into components.
- Put all colors, fonts, radii, spacing in CSS custom properties in `src/styles/tokens.css` so the design can be dropped in by replacing that file + component CSS.
- Use neutral grey placeholder images (aspect 16:9) with the entry code/number overlaid, so the grid looks right without real images.

## Stack
- Astro (latest), static output, TypeScript strict
- Supabase (Postgres + anonymous Auth + RPC + one Edge Function) for votes; supabase-js on the client
- Voting UI as small client islands (Preact or vanilla TS — pick the lightest)
- Cloudflare Turnstile (via Supabase Auth captcha support)
- Deploy target: Vercel
- UI language: Croatian. Code/comments: English.

## Data
`src/data/entries.json` — array of 88 entries. Schema:
```ts
type Entry = {
  id: number;            // 1..88, stable, used in URLs (/rad/1)
  code: string | null;   // official competition code, e.g. "6TVJ3MUHR"
  award: 1|2|3|4|5|null;
  authors: string[];     // empty for unknown
  country: string | null;// ISO-2
  images: string[];      // empty for now -> placeholder
  pdf: string | null;
  sourceUrl: string | null;
};
```
Seed ids 1–5 with the awarded entries below, ids 6–88 as placeholders (code null, authors [], images []). Validate the JSON with zod at build time.

Awarded entries (source: https://stadion-maksimir.zagreb.hr/hr/rezultati-natjecaja-128/128), pdf base https://stadion-maksimir.zagreb.hr/UserDocsImages//dokumenti/ :
1. award 1, code 6TVJ3MUHR — VG13 Architects Studio Associato (Tommaso Fantini, Alberto Rossi), IT — 1nagrada.pdf
2. award 2, code GY0F1A9OM — XDGA, BE — 2nagrada.pdf
3. award 3, code W3YS5VJBZ — Plan Común, Studio Muoto, DATA architectes, Beatriz Borque, Beatriz Saladich, EGITURA, ATMOS LAB — 3nagrada.pdf
4. award 4, code 6PPWVBBBZ — njiric plus arhitekti (Hrvoje Njirić, Iskra Filipović), HR — 4nagrada.pdf
5. award 5, code CYFXC7LIM — LAN S.A.R.L d'Architecture, P2PA Sp. z o.o. — 5nagrada.pdf

Add a script `scripts/import-images.ts` that takes a folder of images named `<id>-<n>.jpg` (e.g. `12-1.jpg`, `12-2.jpg`), optimizes them into `public/entries/`, and fills `images` in entries.json. Images will arrive later.

entries.json is final content (from the official jury report). Use its schema as-is:
{ meta, entries: [{ id, code, award, status: "awarded"|"finalist"|"eliminated"|"excluded",
  eliminatedInRound, descriptionHr, descriptionEn, juryHr[], juryEn[], roundNoteHr[], roundNoteEn[],
  authors, country, images, pdf }] }
- Show HR by default; EN toggle optional.
- Entry detail shows jury text + "Ispao u X. krugu" / "Finalist" / award badge.
- Excluded entries (56, 87, 88) are listed in the grid but NOT included in duels.
- Leaderboard "Narod vs Žiri": compare people's rank with the jury outcome (award > finalist > round reached).

## Pages
- `/` — hero with a one-liner + CTA "Kreni glasati" → `/dvoboj`; below it a responsive grid of all 88 entries (filters: Svi / Nagrađeni / Ostali; sort: po broju / po narodnom rangu). Awarded entries get a badge ("1. nagrada žirija" etc.).
- `/rad/[id]` — entry detail: image gallery, code, authors, country, jury award, link to official PDF, current people's rank + rating, buttons "Ovo je moj favorit" and "Usporedi u dvoboju".
- `/dvoboj` — core voting UX: two entries side by side (stacked on mobile), tap to pick the better one, "Preskoči" option, next pair loads instantly (prefetch the next pair). Progress counter "Odigrao si X dvoboja".
- `/rang` — live leaderboard: people's rank vs jury award side by side, number of duels, favorite votes. Highlight where the people disagree with the jury.
- `/o-projektu` — what this is, that it's unofficial and not affiliated with the City of Zagreb, DAZ or GNK Dinamo, source links, author attribution, takedown contact (placeholder email).
- Footer on every page: "Neslužbena stranica. Autorska prava na radove pripadaju autorima." + source link.

## Voting model (NO login, no accounts — ever)
Visitors never see a sign-in screen. Identity = invisible Supabase **anonymous session** created on first visit, gated by Cloudflare Turnstile (Supabase Auth captcha). No Google/OAuth, no email.

1. **Duels (primary)** — pairwise comparison, Elo (K=32, start 1500).
2. **Favorite (secondary)** — one favorite per anonymous session, changeable.

Pair selection (server-side): prefer entries with the fewest duels so all 88 get fair exposure; avoid pairs this session already judged; add randomness; never pair an entry with itself.

Abuse mitigation (since there are no accounts):
- Turnstile on session creation.
- Server-issued pair tokens — votes only count for pairs the server handed out.
- Rate limits per session AND per IP hash: max 1 duel / 1.5 s; 100 duels / day per session; 200 duels / day per IP hash; at most 5 voting sessions per IP hash per day (migration 20260926120400); max 5 favorites per IP hash per day (households/offices share IPs).
- Store `ip_hash` = sha256(ip + daily-rotating salt) — never raw IPs. Read client IP in an Edge Function from `x-forwarded-for`.
- Admin SQL script `scripts/flag-suspicious.sql` listing sessions/IP hashes with abnormal patterns (e.g. >90% votes for one entry, bursts), plus an `excluded` flag so flagged votes drop out of the leaderboard without being deleted. `recompute_elo()` replays non-excluded duels in order.

## Supabase
Migrations in `supabase/migrations/`. Tables:
- `entries(id int pk, elo numeric default 1500, duels int default 0, wins int default 0)` — seeded 1..88
- `duels(id bigserial, session_id uuid, ip_hash text, winner_id int, loser_id int, excluded bool default false, created_at timestamptz)` with unique(session_id, least(winner_id,loser_id), greatest(winner_id,loser_id))
- `favorites(session_id uuid pk, entry_id int, ip_hash text, excluded bool default false, updated_at timestamptz)`
- `pair_tokens(token uuid pk, session_id uuid, a int, b int, expires_at timestamptz)`

RLS on everything: clients can SELECT `entries` and the `leaderboard` view only; no direct INSERT/UPDATE. All writes via SECURITY DEFINER functions, called through one Edge Function `vote` (adds ip_hash + rate limits), never directly from the client:
- `get_pair()` → issues pair_token + two entry ids
- `vote_duel(token uuid, winner int)` → validates token/session/expiry, rate limits, inserts duel, updates both Elo ratings atomically (row locks), deletes token
- `set_favorite(entry int)` → upsert one favorite per session
- view `leaderboard` → id, elo, rank, duels, wins, favorites count (non-excluded only)

Provide `.env.example` (PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, PUBLIC_TURNSTILE_SITE_KEY, IP_HASH_SALT_SECRET) and a README with setup steps (Supabase project, enable anonymous sign-ins + Turnstile captcha, run migrations, deploy Edge Function, Vercel deploy).

## Also
- SEO: title/description per page, OG tags; per-entry OG image generated at build (satori) with code/number + "Narodni Maksimir".
- Share after 10 duels: "Moj top 3" — share URL `/?top=12,5,40` that renders the user's top picks.
- Accessibility: keyboard voting in duels (← / →), alt texts from entry code + authors.
- Performance: lazy-loaded images, `<Image>` from astro:assets; Lighthouse mobile ≥ 90 on the grid page.
- No cookies beyond the Supabase anonymous session, except Google Analytics after the visitor accepts it (plan D17).

## Order of work
1. Astro scaffold + tokens.css + layout + entries.json (88) + zod schema
2. Grid, detail, about pages with placeholders
3. Supabase migrations + functions + seed; SQL test script (Elo math, rate limit, invalid/expired token, duplicate pair)
4. Edge Function `vote` + duel island + anonymous session + Turnstile
5. Leaderboard + favorites
6. flag-suspicious.sql + recompute_elo, OG images, share, README
Commit after each step. Ask me before choosing anything that affects cost or requires a paid plan.