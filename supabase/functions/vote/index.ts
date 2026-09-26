// Naš Dom: the only write path for votes.
//
// POST { action: 'get_pair', pin?: number }
//      { action: 'vote_duel', token: string, winner: number }
//      { action: 'set_favorite', entry: number | null }
// Authorization: Bearer <anonymous user's access token>
//
// The caller must be an anonymous Supabase user (the session id is the JWT `sub`).
// The function adds the salted ip_hash and calls the SECURITY DEFINER RPCs with the
// service-role key. Responses mirror the RPC jsonb: { ok: true, ... } or
// { ok: false, code, retry_after? }; limits come back as 429 with Retry-After.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// Legacy service_role key, or the default key of the new secret keys.
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const SALT_SECRET = Deno.env.get('IP_HASH_SALT_SECRET');
// Comma-separated origins, e.g. "https://nasdom.top,http://localhost:4321". Unset = any.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RPC error code -> HTTP status. Unknown codes fall back to 409.
const STATUS: Record<string, number> = {
  rate_limited: 429,
  daily_limit: 429,
  invalid_entry: 400,
  invalid_token: 409,
  expired_token: 409,
  wrong_session: 409,
  already_judged: 409,
  no_pair: 409,
};

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = ALLOWED_ORIGINS.length === 0 ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Expose-Headers': 'retry-after',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...corsHeaders(req), ...extra } });
}

function fail(req: Request, status: number, code: string): Response {
  return json(req, status, { ok: false, code });
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// The salt rotates at midnight in Zagreb, the same day boundary as the daily limits.
const saltCache = new Map<string, string>();
async function dailySalt(): Promise<string> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(new Date());
  let salt = saltCache.get(day);
  if (!salt) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SALT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(day));
    salt = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
    saltCache.clear();
    saltCache.set(day, salt);
  }
  return salt;
}

// The first x-forwarded-for hop is the client. The raw IP never leaves this function.
async function ipHash(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return sha256Hex(ip + (await dailySalt()));
}

const isEntryId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 88;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method_not_allowed');
  if (!SERVICE_KEY || !SALT_SECRET) {
    console.error('vote: missing SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEYS or IP_HASH_SALT_SECRET');
    return fail(req, 500, 'server_error');
  }

  // Verify the caller's JWT ourselves: the platform check also lets bare API keys through.
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return fail(req, 401, 'unauthorized');
  const { data: auth, error: authError } = await admin.auth.getClaims(jwt);
  const claims = auth?.claims;
  if (authError || !claims?.sub || claims.is_anonymous !== true) return fail(req, 401, 'unauthorized');
  const session = claims.sub;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(req, 400, 'bad_request');
  }
  if (typeof body !== 'object' || body === null) return fail(req, 400, 'bad_request');

  const ip_hash = await ipHash(req);
  let rpc: { fn: string; args: Record<string, unknown> };
  switch (body.action) {
    case 'get_pair':
      if (body.pin != null && !isEntryId(body.pin)) return fail(req, 400, 'invalid_entry');
      rpc = { fn: 'get_pair', args: { p_session: session, p_ip_hash: ip_hash, p_pin: body.pin ?? null } };
      break;
    case 'vote_duel':
      if (typeof body.token !== 'string' || !UUID_RE.test(body.token)) return fail(req, 409, 'invalid_token');
      if (!isEntryId(body.winner)) return fail(req, 400, 'invalid_entry');
      rpc = {
        fn: 'vote_duel',
        args: { p_token: body.token, p_winner: body.winner, p_session: session, p_ip_hash: ip_hash },
      };
      break;
    case 'set_favorite':
      if (body.entry !== null && !isEntryId(body.entry)) return fail(req, 400, 'invalid_entry');
      rpc = { fn: 'set_favorite', args: { p_entry: body.entry, p_session: session, p_ip_hash: ip_hash } };
      break;
    default:
      return fail(req, 400, 'bad_request');
  }

  const { data, error } = await admin.rpc(rpc.fn, rpc.args);
  if (error) {
    console.error(`vote: ${rpc.fn} failed`, error);
    return fail(req, 500, 'server_error');
  }

  const result = data as { ok: boolean; code?: string; retry_after?: number };
  if (result.ok) return json(req, 200, result);
  const extra: Record<string, string> = result.retry_after ? { 'Retry-After': String(result.retry_after) } : {};
  return json(req, STATUS[result.code ?? ''] ?? 409, result, extra);
});
