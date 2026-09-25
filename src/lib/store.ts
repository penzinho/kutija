/** The browser's UI mirror of the visitor's own activity (localStorage `nm-v1`, D9). */
export type Saved = {
  /** The one favorite of this session (D9); the server keeps the real vote. */
  fav: number | null;
  /** Duels played in this browser. */
  played: number;
  /** Duel wins per entry id, as chosen by this visitor. */
  userWins: Record<string, number>;
};

export const STORE_KEY = 'nm-v1';

const EMPTY: Saved = { fav: null, played: 0, userWins: {} };

/** Never throws: private mode, blocked storage or garbage all read as empty. */
export function loadSaved(): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return { ...EMPTY };
    const r = raw as Record<string, unknown>;
    return {
      fav: Number.isInteger(r.fav) ? (r.fav as number) : null,
      played: Number.isInteger(r.played) ? (r.played as number) : 0,
      userWins: typeof r.userWins === 'object' && r.userWins !== null ? (r.userWins as Record<string, number>) : {},
    };
  } catch {
    return { ...EMPTY };
  }
}
