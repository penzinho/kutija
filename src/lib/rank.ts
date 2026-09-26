/**
 * The people's ranking: types, formatting and readers for the public `leaderboard` and
 * `stats` views. Used at build time (src/data/ranks.ts) and in the browser (src/lib/live.ts).
 * Reads are plain PostgREST GETs with the anon key: no session, no supabase-js.
 */

/** One row of the `leaderboard` view. */
export type RankInfo = {
  rank: number;
  /** Rank at the last daily snapshot; null until the first snapshot exists (D10). */
  rank24h: number | null;
  elo: number;
  duels: number;
  wins: number;
  favorites: number;
};

/** Ranked (non-excluded) entries by id. */
export type Ranks = ReadonlyMap<number, RankInfo>;

export type Stats = { totalDuels: number };

const fmt = new Intl.NumberFormat('hr-HR');
export const formatNumber = (n: number) => fmt.format(n);

export type Trend = 'up' | 'down' | 'flat';

/** The 24h movement as shown in rank chips and the leaderboard. Positive delta = climbed. */
export function rankDelta(r: RankInfo | undefined): { trend: Trend; text: string; label: string } {
  const delta = r && r.rank24h !== null ? r.rank24h - r.rank : null;
  if (delta === null) return { trend: 'flat', text: '—', label: 'bez podatka od jučer' };
  if (delta === 0) return { trend: 'flat', text: '—', label: 'bez promjene u 24 h' };
  return delta > 0
    ? { trend: 'up', text: `▲ ${delta}`, label: `gore ${delta} u 24 h` }
    : { trend: 'down', text: `▼ ${-delta}`, label: `dolje ${-delta} u 24 h` };
}

export const winRate = (r: RankInfo) => (r.duels ? `${Math.round((r.wins / r.duels) * 100)} %` : '—');

// --- Readers ----------------------------------------------------------------------

type Env = { url: string; key: string };

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

async function get(env: Env, path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    headers: { apikey: env.key, accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

/** Throws on network errors or an unexpected shape; rows with bad fields are dropped. */
export async function fetchRanks(env: Env, signal?: AbortSignal): Promise<Ranks> {
  const rows = await get(env, 'leaderboard?select=id,elo,rank,rank_24h,duels,wins,favorites', signal);
  if (!Array.isArray(rows)) throw new Error('leaderboard: not an array');
  const out = new Map<number, RankInfo>();
  for (const row of rows as Record<string, unknown>[]) {
    const [id, rank, elo, duels, wins, favorites] = [row.id, row.rank, row.elo, row.duels, row.wins, row.favorites].map(int);
    if (id === null || rank === null || elo === null || duels === null || wins === null || favorites === null) continue;
    out.set(id, { rank, rank24h: int(row.rank_24h), elo, duels, wins, favorites });
  }
  return out;
}

export async function fetchStats(env: Env, signal?: AbortSignal): Promise<Stats> {
  const rows = await get(env, 'stats?select=total_duels', signal);
  const total = Array.isArray(rows) ? int((rows[0] as Record<string, unknown> | undefined)?.total_duels) : null;
  if (total === null) throw new Error('stats: unexpected shape');
  return { totalDuels: total };
}
