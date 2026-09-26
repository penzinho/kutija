/**
 * Live data in the browser (D11): the people's ranking and the vote counter, read from the
 * public views and shared by every island and page script. Survives ClientRouter
 * navigations (module state), so a page swap re-renders from memory before refetching.
 */
import { fetchRanks, fetchStats, type Ranks } from './rank';

const env = { url: import.meta.env.PUBLIC_SUPABASE_URL ?? '', key: import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '' };
const enabled = Boolean(env.url && env.key);

/** How often visible pages refresh live data. */
export const POLL_MS = 5000;

type Listener<T> = (value: T) => void;

function createStore<T>() {
  let value: T | null = null;
  const listeners = new Set<Listener<T>>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l(next));
    },
    /** Calls back now (when there is a value) and on every change. Returns unsubscribe. */
    subscribe(l: Listener<T>) {
      listeners.add(l);
      if (value !== null) l(value);
      return () => void listeners.delete(l);
    },
  };
}

// --- Ranks ------------------------------------------------------------------------

const ranks = createStore<Ranks>();
let ranksAt = 0;
let ranksInFlight: Promise<Ranks | null> | null = null;

export const getRanks = ranks.get;
export const subscribeRanks = ranks.subscribe;

/**
 * Fetches the leaderboard unless the last copy is younger than `maxAge` ms. Concurrent
 * callers share one request. Resolves null on failure and keeps the last good copy.
 */
export function refreshRanks(maxAge = 0): Promise<Ranks | null> {
  if (!enabled) return Promise.resolve(null);
  if (ranks.get() && Date.now() - ranksAt < maxAge) return Promise.resolve(ranks.get());
  ranksInFlight ??= fetchRanks(env, AbortSignal.timeout(POLL_MS))
    .then(
      (next) => {
        ranksAt = Date.now();
        ranks.set(next);
        return next;
      },
      () => null,
    )
    .finally(() => (ranksInFlight = null));
  return ranksInFlight;
}

// --- Vote counter -----------------------------------------------------------------

const total = createStore<number>();
let bumpedAt = 0;
let totalInFlight: Promise<void> | null = null;

export const getTotal = total.get;
export const subscribeTotal = total.subscribe;

export function refreshTotal(): Promise<void> {
  if (!enabled) return Promise.resolve();
  const startedAt = Date.now();
  totalInFlight ??= fetchStats(env, AbortSignal.timeout(POLL_MS))
    .then(
      ({ totalDuels }) => {
        // A read that started before our own vote may not include it yet: never step back.
        const shown = total.get();
        total.set(startedAt < bumpedAt && shown !== null ? Math.max(totalDuels, shown) : totalDuels);
      },
      () => {},
    )
    .finally(() => (totalInFlight = null));
  return totalInFlight;
}

/** The visitor's own recorded vote shows up at once (+1), before the next poll. */
export function bumpTotal(): void {
  bumpedAt = Date.now();
  const shown = total.get();
  if (shown !== null) total.set(shown + 1);
}

// --- Polling ----------------------------------------------------------------------

/**
 * Runs `task` now and every `ms` while the tab is visible; a tab coming back runs it at
 * once. Returns a stop function.
 */
export function poll(task: () => unknown, ms = POLL_MS): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    clearInterval(timer);
    task();
    timer = setInterval(task, ms);
  };
  const onVisibility = () => {
    if (document.hidden) clearInterval(timer);
    else start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (!document.hidden) start();
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
