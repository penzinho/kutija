/**
 * Build-time snapshot of the people's ranking, so the static HTML carries real numbers.
 * The browser replaces them with live values (src/lib/live.ts). Without Supabase env or
 * network the build still succeeds: pages render "—" until the live data arrives.
 */
import { fetchRanks, fetchStats, type RankInfo, type Ranks } from '../lib/rank';

export type { RankInfo } from '../lib/rank';

const env = { url: import.meta.env.PUBLIC_SUPABASE_URL ?? '', key: import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '' };

async function snapshot(): Promise<{ ranks: Ranks; totalDuels: number | null }> {
  if (!env.url || !env.key) {
    console.warn('[ranks] PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY not set: building without ranks');
    return { ranks: new Map(), totalDuels: null };
  }
  try {
    const signal = AbortSignal.timeout(8000);
    const [ranks, stats] = await Promise.all([fetchRanks(env, signal), fetchStats(env, signal)]);
    return { ranks, totalDuels: stats.totalDuels };
  } catch (e) {
    console.warn(`[ranks] could not read the leaderboard, building without ranks: ${String(e)}`);
    return { ranks: new Map(), totalDuels: null };
  }
}

const { ranks, totalDuels: total } = await snapshot();

/** The people's rank for an entry; undefined for excluded entries or when the build had no data. */
export function getRank(id: number): RankInfo | undefined {
  return ranks.get(id);
}

/** Every ranked entry, as of the build. */
export const buildRanks: Ranks = ranks;

/** Total duels played (the `stats` view, D11) as of the build; null when unknown. */
export const totalDuels: number | null = total;
