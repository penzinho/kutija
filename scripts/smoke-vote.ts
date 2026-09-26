/**
 * End-to-end check of the deployed `vote` Edge Function:
 * anonymous sign-in → get pair → vote → Elo changes → replayed token is rejected.
 *
 *   pnpm tsx --env-file=.env scripts/smoke-vote.ts
 *
 * Needs PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY. If captcha is on, set
 * SMOKE_CAPTCHA_TOKEN (with Turnstile's test secret, any token such as
 * XXXX.DUMMY.TOKEN.XXXX passes). It records one real duel and one favorite.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are required');

const supabase = createClient(url, key, { auth: { persistSession: false } });
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

async function vote(jwt: string | null, body: unknown) {
  const res = await fetch(`${url}/functions/v1/vote`, {
    method: 'POST',
    headers: { apikey: key!, 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function elo(ids: number[]) {
  const { data, error } = await supabase.from('leaderboard').select('id, elo, duels').in('id', ids);
  if (error) throw error;
  return new Map(data.map((r) => [r.id as number, r]));
}

const { data: signIn, error } = await supabase.auth.signInAnonymously({
  options: { captchaToken: process.env.SMOKE_CAPTCHA_TOKEN },
});
if (error || !signIn.session) throw new Error(`anonymous sign-in failed: ${error?.message}`);
const jwt = signIn.session.access_token;
check('anonymous sign-in', signIn.user?.is_anonymous === true);

const noAuth = await vote(null, { action: 'get_pair' });
check('no JWT → 401', noAuth.status === 401, noAuth);
const keyOnly = await vote(key, { action: 'get_pair' });
check('API key as JWT → 401', keyOnly.status === 401, keyOnly);

const pair = await vote(jwt, { action: 'get_pair' });
check('get_pair', pair.status === 200 && pair.body?.ok === true && pair.body.a !== pair.body.b, pair);
const { token, a, b } = pair.body!;

const before = await elo([a, b]);
const duel = await vote(jwt, { action: 'vote_duel', token, winner: a });
check('vote_duel', duel.status === 200 && duel.body?.winner === a && duel.body?.loser === b, duel);
const after = await elo([a, b]);
check(
  'Elo changed',
  after.get(a)!.duels === before.get(a)!.duels + 1 && after.get(b)!.duels === before.get(b)!.duels + 1,
  { before: [...before.values()], after: [...after.values()] },
);

const replay = await vote(jwt, { action: 'vote_duel', token, winner: a });
check('replayed token rejected', replay.status === 409 && replay.body?.code === 'invalid_token', replay);

const pinned = await vote(jwt, { action: 'get_pair', pin: 16 });
check('pinned pair', pinned.body?.ok === true && [pinned.body.a, pinned.body.b].includes(16), pinned);
const tooFast = await vote(jwt, { action: 'vote_duel', token: pinned.body?.token, winner: 16 });
check('1.5 s limit → 429', tooFast.status === 429 && tooFast.body?.code === 'rate_limited', tooFast);

const excluded = await vote(jwt, { action: 'get_pair', pin: 56 });
check('excluded pin rejected', excluded.status === 400 && excluded.body?.code === 'invalid_entry', excluded);

const fav = await vote(jwt, { action: 'set_favorite', entry: a });
check('set_favorite', fav.status === 200 && fav.body?.entry === a, fav);

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
