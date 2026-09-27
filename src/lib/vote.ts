/** Typed client for the `vote` Edge Function (the only write path, D7). */
import { ensureSession, resetSession } from './session';

const ENDPOINT = `${import.meta.env.PUBLIC_SUPABASE_URL ?? ''}/functions/v1/vote`;
const API_KEY: string = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';

export type VoteErrorCode =
  | 'rate_limited'
  | 'daily_limit'
  | 'invalid_token'
  | 'expired_token'
  | 'wrong_session'
  | 'invalid_entry'
  | 'already_judged'
  | 'no_pair'
  | 'unauthorized'
  | 'bad_request'
  | 'session_failed'
  | 'network'
  | 'server_error';

export type VoteError = { ok: false; code: VoteErrorCode; retry_after?: number };

/** `pinned` is false when the server ignored the pin (that entry was already shown today). */
export type Pair = { ok: true; token: string; a: number; b: number; expires_at: string; pinned?: boolean };
export type DuelResult = { ok: true; winner: number; loser: number; delta: number };
export type FavoriteResult = { ok: true; entry: number | null };

type Request =
  | { action: 'get_pair'; pin?: number }
  | { action: 'vote_duel'; token: string; winner: number }
  | { action: 'set_favorite'; entry: number | null };

async function call<T>(body: Request, retried = false): Promise<T | VoteError> {
  let jwt: string;
  try {
    jwt = await ensureSession();
  } catch {
    return { ok: false, code: 'session_failed' };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, apikey: API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'network' };
  }

  // A deleted or revoked anonymous user: start a fresh session once.
  if (res.status === 401 && !retried) {
    await resetSession();
    return call<T>(body, true);
  }

  try {
    return (await res.json()) as T | VoteError;
  } catch {
    return { ok: false, code: res.status === 401 ? 'unauthorized' : 'server_error' };
  }
}

/** A server-issued pair; `pin` fixes one side (`/dvoboj?a=id`). */
export const getPair = (pin?: number) => call<Pair>({ action: 'get_pair', ...(pin ? { pin } : {}) });

export const voteDuel = (token: string, winner: number) => call<DuelResult>({ action: 'vote_duel', token, winner });

/** Sets (or clears, with null) this session's one favorite (D9). */
export const setFavoriteRemote = (entry: number | null) => call<FavoriteResult>({ action: 'set_favorite', entry });
