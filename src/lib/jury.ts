/**
 * The jury's order, for comparing it with the people's rank: awards 1–5, then the
 * finalists, then the eliminated entries by the round they reached (6 → 1). Entries in
 * one group are tied, so each gets a band of places [lo, hi]. Excluded entries are not ranked.
 */
import type { Entry } from '../data/entries';

type JuryFields = Pick<Entry, 'id' | 'status' | 'award' | 'eliminatedInRound'>;

export type JuryBand = { lo: number; hi: number };

/** Sort key: lower = the jury rated it higher. Null for excluded entries. */
function tier(e: JuryFields): number | null {
  switch (e.status) {
    case 'awarded':
      return e.award!;
    case 'finalist':
      return 10;
    case 'eliminated':
      return 20 + (6 - e.eliminatedInRound!);
    case 'excluded':
      return null;
  }
}

export function juryBands(entries: readonly JuryFields[]): Map<number, JuryBand> {
  const groups = new Map<number, number[]>();
  for (const e of entries) {
    const t = tier(e);
    if (t !== null) groups.set(t, [...(groups.get(t) ?? []), e.id]);
  }
  const bands = new Map<number, JuryBand>();
  let next = 1;
  for (const t of [...groups.keys()].sort((a, b) => a - b)) {
    const ids = groups.get(t)!;
    for (const id of ids) bands.set(id, { lo: next, hi: next + ids.length - 1 });
    next += ids.length;
  }
  return bands;
}

/**
 * How far the people's rank is from the jury's band. Positive: the people rank it
 * higher than the jury did; negative: lower; 0 inside the band.
 */
export function juryGap(band: JuryBand, peopleRank: number): number {
  if (peopleRank < band.lo) return band.lo - peopleRank;
  if (peopleRank > band.hi) return band.hi - peopleRank;
  return 0;
}

/** The jury's verdict in a few words, for tables and cards. */
export function juryShort(e: JuryFields): string {
  switch (e.status) {
    case 'awarded':
      return `${e.award}. nagrada`;
    case 'finalist':
      return 'Finalist';
    case 'eliminated':
      return `Ispao u ${e.eliminatedInRound}. krugu`;
    case 'excluded':
      return 'Nije ocjenjivan';
  }
}
