# Naš Dom

Unofficial public gallery and people's vote for the 88 Maksimir stadium competition entries. See `SPEC.md` and `plan.md`.

```sh
pnpm install
cp .env.example .env   # fill in the values
pnpm dev
```

## Supabase

Cloud project `srqdfixcngwpfwllljse` (no local Docker).

```sh
pnpm dlx supabase db push                                            # migrations
pnpm dlx supabase db query --linked -f supabase/tests/voting.sql     # SQL tests, prints "all passed"
```

### Anonymous sessions + Turnstile (dashboard, once)

1. **Cloudflare → Turnstile → Add widget**: widget mode *Invisible*, hostnames = the production domain and `localhost`. Copy the site key and the secret key.
2. **Supabase → Authentication → Sign In / Providers**: turn on *Allow anonymous sign-ins*. Turn off *Email* sign-ups (visitors never have accounts; the function only accepts anonymous users anyway).
3. **Supabase → Authentication → Attack Protection**: enable *CAPTCHA protection*, provider *Turnstile*, paste the Turnstile **secret** key.
4. Put the **site** key in `PUBLIC_TURNSTILE_SITE_KEY` (`.env` and Vercel).

For local dev without a real widget, use Cloudflare's test keys: site key `1x00000000000000000000BB` (invisible, always passes) with secret `1x0000000000000000000000000000000AA` in Supabase.

The client (`src/lib/session.ts`) loads supabase-js and Turnstile and signs in only on the first vote, so plain page views create no session.

### Edge Function `vote`

All vote writes go through `supabase/functions/vote` (`get_pair`, `vote_duel`, `set_favorite`). It verifies the anonymous user's JWT, hashes the IP with a daily salt derived from `IP_HASH_SALT_SECRET`, and calls the SECURITY DEFINER functions with the service-role key.

```sh
pnpm dlx supabase secrets set IP_HASH_SALT_SECRET="$(openssl rand -hex 32)"
pnpm dlx supabase secrets set ALLOWED_ORIGINS=https://<production-domain>,http://localhost:4321   # optional
pnpm dlx supabase functions deploy vote
pnpm tsx --env-file=.env scripts/smoke-vote.ts                      # end-to-end check, prints "all passed"
```

The smoke test records one real duel and one favorite; clear test data before launch.

## Share and OG images

- Per-entry OG images (`/og/rad/<id>.jpg`) and the site-wide one (`/og/default.jpg`) are rendered at build time with satori + sharp (`src/lib/og.ts`, `src/pages/og/`). Colors come from `src/styles/tokens.css`.
- `og:image` must be absolute, so set `SITE_URL` in Vercel (the Vercel production domain is the fallback).
- "Moj top 3" links (`/?top=a,b,c`) share the home page's OG image: the site is static, so a per-share image would need a serverless function (plan D12).
- Check previews after deploy: [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/), or [opengraph.xyz](https://www.opengraph.xyz/).

## Moderation

`scripts/flag-suspicious.sql` lists sessions/IP hashes where one entry wins >90% of 10+
duels (`bias`), sessions with 20+ duels inside 60 s (`burst`), and IP hashes with more
than 20 sessions (`sessions`; the hash rotates daily, so that's per day). The logic is the
`private.suspicious` view, which is one result set because `supabase db query` prints only
the last statement.

```sh
pnpm dlx supabase db query --linked -f scripts/flag-suspicious.sql
```

Review the rows, then flag what's actually abuse: `private.flag_session('<session_id>')`
for rows with a session, `private.flag_ip('<ip_hash>')` for IP-only rows (both in
`supabase/migrations/20260926120200_moderation.sql`). These only set `excluded = true` on
that session's/IP's `duels` and `favorites` rows; nothing is deleted. Once you're done
flagging for the pass, replay Elo without the excluded rows:

```sql
select public.recompute_elo();
```

Tests: `pnpm dlx supabase db query --linked -f supabase/tests/moderation.sql`.

## Google Analytics (optional)

Set `PUBLIC_GA_ID` (GA4 measurement ID, `G-…`) in `.env` / Vercel. Without it there is no analytics and no banner.

- GA loads only after the visitor clicks *Prihvati* on the cookie banner (`src/components/ConsentBanner.astro`, `src/lib/analytics.ts`); before that no request goes to Google. The footer's *Kolačići* button reopens the banner; *Odbij* removes the `_ga` cookies.
- Google signals and ad personalization are off. Page views are sent on every ClientRouter navigation.
- Custom events: `duel_vote`, `top3_ready`, `share`.
