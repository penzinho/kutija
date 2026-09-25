import { duelEligible } from './entries';

/** One row of the people's ranking; mirrors the `leaderboard` view (step 4). */
export type RankInfo = {
  rank: number;
  /** Rank at the last daily snapshot; null until the first snapshot exists (D10). */
  rank24h: number | null;
  elo: number;
  duels: number;
  wins: number;
  favorites: number;
};

// STUB for step 3: deterministic fake ranks so pages render without a backend.
// Step 7 replaces this with data from the `leaderboard` view.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStub(): Map<number, RankInfo> {
  const rnd = mulberry32(88);
  const rows = duelEligible.map((e) => {
    const elo = Math.round(1500 + (rnd() - 0.5) * 360 + (e.award ? (6 - e.award) * 30 : 0));
    const duels = 40 + Math.floor(rnd() * 260);
    const winRate = Math.min(0.85, Math.max(0.15, 0.5 + (elo - 1500) / 500));
    return { id: e.id, elo, duels, wins: Math.round(duels * winRate), favorites: Math.floor(rnd() * 120) };
  });
  rows.sort((a, b) => b.elo - a.elo);
  const n = rows.length;
  return new Map(
    rows.map((r, i) => {
      const rank = i + 1;
      const drift = Math.round((rnd() - 0.5) * 12);
      const rank24h = rnd() < 0.15 ? null : Math.min(n, Math.max(1, rank + drift));
      return [r.id, { rank, rank24h, elo: r.elo, duels: r.duels, wins: r.wins, favorites: r.favorites }];
    }),
  );
}

const ranks = buildStub();

/** The people's rank for an entry; undefined for excluded entries (they are never ranked). */
export function getRank(id: number): RankInfo | undefined {
  return ranks.get(id);
}

/** Total duels played so far (the `stats` view, D11). STUB: every duel counts for two entries. */
export const totalDuels = Math.round([...ranks.values()].reduce((sum, r) => sum + r.duels, 0) / 2);
