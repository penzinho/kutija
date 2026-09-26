/**
 * Fills server-rendered pages with live data. Markup opts in with attributes:
 *   [data-counter]                      .nm-reel showing total duels (header, home hero)
 *   [data-rank-chip="id"]               RankChip.astro
 *   [data-panel-rank="id"]              "Građani #N · Elo" on a card's hover panel
 *   .entry-card[data-id]                gets data-rank (FilterBar sorts by it)
 *   [data-live="field"][data-live-id]   one number: rank | elo | duels | wins | favorites | winrate
 * After ranks are applied, `nm:ranks` is dispatched on document.
 */
import { formatNumber, rankDelta, winRate, type RankInfo, type Ranks } from './rank';
import { getRanks, getTotal, poll, refreshRanks, refreshTotal, subscribeRanks, subscribeTotal } from './live';
import { setReel } from './reel';

type Field = 'rank' | 'elo' | 'duels' | 'wins' | 'favorites' | 'winrate';

function fieldText(r: RankInfo, field: Field): string {
  return field === 'winrate' ? winRate(r) : formatNumber(r[field]);
}

function applyRanks(ranks: Ranks): void {
  const rankOf = (el: HTMLElement, attr: string) => ranks.get(Number(el.getAttribute(attr)));

  document.querySelectorAll<HTMLElement>('[data-rank-chip]').forEach((chip) => {
    const r = rankOf(chip, 'data-rank-chip');
    if (!r) return;
    const d = rankDelta(r);
    const delta = chip.querySelector<HTMLElement>('[data-rc-delta]')!;
    chip.querySelector('[data-rc-rank]')!.textContent = `#${r.rank}`;
    delta.textContent = d.text;
    delta.dataset.trend = d.trend;
    delta.hidden = false;
    chip.querySelector('[data-rc-label]')!.textContent = d.label;
  });

  document.querySelectorAll<HTMLElement>('[data-panel-rank]').forEach((el) => {
    const r = rankOf(el, 'data-panel-rank');
    if (!r) return;
    el.textContent = `Građani #${r.rank} · ${formatNumber(r.elo)}`;
    el.hidden = false;
  });

  document.querySelectorAll<HTMLElement>('.entry-card[data-id]').forEach((card) => {
    const r = rankOf(card, 'data-id');
    if (r) card.dataset.rank = String(r.rank);
  });

  document.querySelectorAll<HTMLElement>('[data-live][data-live-id]').forEach((el) => {
    const r = rankOf(el, 'data-live-id');
    if (!r) return;
    const field = el.dataset.live as Field;
    if (el.classList.contains('nm-reel') && field !== 'winrate') setReel(el, r[field]);
    else el.textContent = fieldText(r, field);
  });

  document.dispatchEvent(new CustomEvent('nm:ranks'));
}

function applyTotal(total: number): void {
  document.querySelectorAll<HTMLElement>('.nm-reel[data-counter]').forEach((el) => setReel(el, total));
}

let started = false;

/** Call on every `astro:page-load`. */
export function bindLivePage(): void {
  if (!started) {
    started = true;
    // Header counter on every page; the subscriptions outlive page swaps and always
    // write into the current document.
    poll(refreshTotal);
    subscribeTotal(applyTotal);
    subscribeRanks(applyRanks);
  } else {
    // A swapped-in page shows build-time numbers: bring it up to date from memory.
    const total = getTotal();
    const ranks = getRanks();
    if (total !== null) applyTotal(total);
    if (ranks) applyRanks(ranks);
  }
  // Pages with rank hooks refresh on load; /rang polls on its own (Leaderboard island).
  if (document.querySelector('[data-rank-chip],[data-panel-rank],[data-live-id]')) void refreshRanks(2000);
}
