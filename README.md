# Narodni Maksimir

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
