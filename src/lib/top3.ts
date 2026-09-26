/**
 * "Moj top 3" (SPEC share, design share card): the visitor's most-picked duel winners,
 * padded with the people's top entries when they have fewer than three.
 */

export const TOP_SIZE = 3;

/**
 * @param userWins duel wins per entry id, from the `nm-v1` mirror
 * @param eligible entry ids that can appear (duel-eligible, in id order)
 * @param rankOf the people's rank, or null when unknown; breaks ties and orders the padding
 */
export function pickTop3(
  userWins: Record<string, number>,
  eligible: readonly number[],
  rankOf: (id: number) => number | null,
): number[] {
  const rank = (id: number) => rankOf(id) ?? Number.MAX_SAFE_INTEGER;
  const byRank = (a: number, b: number) => rank(a) - rank(b) || a - b;
  const known = new Set(eligible);

  const picked = Object.entries(userWins)
    .map(([id, wins]) => [Number(id), wins] as const)
    .filter(([id, wins]) => known.has(id) && Number.isFinite(wins) && wins > 0)
    .sort(([a, wa], [b, wb]) => wb - wa || byRank(a, b))
    .map(([id]) => id)
    .slice(0, TOP_SIZE);

  for (const id of [...eligible].sort(byRank)) {
    if (picked.length === TOP_SIZE) break;
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

/** The static share link that renders the block on the home page (TopPicks.astro). */
export function top3Url(origin: string, ids: readonly number[]): string {
  return `${origin}/?top=${ids.join(',')}`;
}
