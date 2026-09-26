/**
 * The visitor's invisible anonymous Supabase session.
 *
 * Nothing here runs on page load: supabase-js and Turnstile are loaded, and the session
 * is created, only when the visitor first votes (`ensureSession`). Plain page views set
 * no session. Once created, supabase-js keeps it in localStorage and refreshes it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL: string = import.meta.env.PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY: string = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const TURNSTILE_SITE_KEY: string = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';

let clientPromise: Promise<SupabaseClient> | null = null;

/** The shared client, loaded on first use. Reading the public views needs no session. */
export function getSupabase(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  );
  return clientPromise;
}

// --- Turnstile (invisible widget) -------------------------------------------------

type Turnstile = {
  render(el: HTMLElement, opts: Record<string, unknown>): string | undefined;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileScript: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  turnstileScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => {
      turnstileScript = null;
      reject(new Error('turnstile'));
    };
    document.head.append(s);
  });
  return turnstileScript;
}

/** One single-use Turnstile token. The widget is invisible unless Cloudflare needs an interaction. */
async function captchaToken(): Promise<string> {
  const turnstile = await loadTurnstile();
  const host = document.createElement('div');
  host.className = 'nm-turnstile';
  document.body.append(host);
  let id: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      id = turnstile.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        callback: resolve,
        'error-callback': () => reject(new Error('turnstile')),
        'expired-callback': () => reject(new Error('turnstile')),
      });
    });
  } finally {
    if (id) turnstile.remove(id);
    host.remove();
  }
}

// --- Session ----------------------------------------------------------------------

let signingIn: Promise<string> | null = null;

/**
 * Returns a valid access token, signing in anonymously (with Turnstile) the first time.
 * Concurrent callers share one sign-in. Throws `SessionError` if sign-in fails.
 */
export async function ensureSession(): Promise<string> {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;

  signingIn ??= (async () => {
    try {
      // Without a site key (local dev) the project must have captcha turned off.
      const token = TURNSTILE_SITE_KEY ? await captchaToken() : undefined;
      const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken: token } });
      if (error || !data.session) throw new SessionError(error?.message ?? 'no session');
      return data.session.access_token;
    } catch (e) {
      throw e instanceof SessionError ? e : new SessionError(String(e));
    } finally {
      signingIn = null;
    }
  })();
  return signingIn;
}

/** Drops a session the server no longer accepts; the next `ensureSession` creates a new one. */
export async function resetSession(): Promise<void> {
  const supabase = await getSupabase();
  await supabase.auth.signOut({ scope: 'local' });
}

export class SessionError extends Error {
  override name = 'SessionError';
}
