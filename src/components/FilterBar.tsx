import { useEffect, useRef, useState } from 'preact/hooks';
import { loadSaved } from '../lib/store';
import s from './FilterBar.module.css';

type Filter = 'svi' | 'nagradeni' | 'ostali' | 'favoriti';
type Sort = 'broj' | 'rang';

interface Props {
  /** id of the grid holding the server-rendered EntryCards (data-id / data-award / data-rank). */
  grid: string;
  /** id of the "Još nemaš favorita" block, shown when the filter matches nothing. */
  empty: string;
  total: number;
  awarded: number;
}

const RESTAGGER = 16;

const reduced = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'calm';

/** 1 rad, 2–4 rada, 5+ radova (11–14 radova). */
function radova(n: number) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} rad`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} rada`;
  return `${n} radova`;
}

export default function FilterBar({ grid, empty, total, awarded }: Props) {
  const [filter, setFilter] = useState<Filter>('svi');
  const [sort, setSort] = useState<Sort>('broj');
  const [fav, setFav] = useState<number | null>(null);
  const [favCount, setFavCount] = useState(0);
  const [shown, setShown] = useState(total);
  const firstRun = useRef(true);

  useEffect(() => {
    const read = () => setFav(loadSaved().fav);
    read();
    // Another tab picked a favorite.
    addEventListener('storage', read);
    return () => removeEventListener('storage', read);
  }, []);

  useEffect(() => {
    const gridEl = document.getElementById(grid);
    if (!gridEl) return;
    const cards = [...gridEl.querySelectorAll<HTMLElement>(':scope > [data-id]')];
    const id = (c: HTMLElement) => Number(c.dataset.id);
    // Entries outside the people's ranking (excluded) have no data-rank and go last.
    const rank = (c: HTMLElement) => (c.dataset.rank ? Number(c.dataset.rank) : Infinity);
    const keep = (c: HTMLElement) =>
      filter === 'nagradeni'
        ? c.dataset.award !== undefined
        : filter === 'ostali'
          ? c.dataset.award === undefined
          : filter === 'favoriti'
            ? id(c) === fav
            : true;

    setFavCount(cards.some((c) => id(c) === fav) ? 1 : 0);

    const untouched = firstRun.current && filter === 'svi' && sort === 'broj';
    const animate = !firstRun.current && !reduced();
    firstRun.current = false;
    if (untouched) return;

    const key = sort === 'rang' ? rank : id;
    cards.sort((a, b) => key(a) - key(b) || id(a) - id(b));
    let n = 0;
    for (const c of cards) {
      c.hidden = !keep(c);
      if (!c.hidden) n++;
      gridEl.append(c); // moving nodes keeps loaded images; DOM order = tab order
    }
    setShown(n);
    gridEl.hidden = n === 0;
    const emptyEl = document.getElementById(empty);
    if (emptyEl) emptyEl.hidden = n !== 0;

    if (animate) {
      cards
        .filter((c) => !c.hidden)
        .slice(0, RESTAGGER)
        .forEach((c, i) =>
          c.animate(
            [
              { opacity: 0, transform: 'translateY(18px) scale(.98)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 420, delay: i * 35, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' },
          ),
        );
    }
  }, [filter, sort, fav]);

  const filters: [Filter, string, number][] = [
    ['svi', 'Svi', total],
    ['nagradeni', 'Nagrađeni', awarded],
    ['ostali', 'Ostali', total - awarded],
    ['favoriti', 'Moji favoriti', favCount],
  ];

  return (
    <div class={s.bar}>
      <div class={s.chips} role="group" aria-label="Filtriraj radove">
        {filters.map(([k, label, count]) => (
          <button type="button" class={s.chip} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
            <span class={s.count}>{count}</span>
          </button>
        ))}
      </div>
      <div class={s.sort}>
        <span class={s.sortLabel} id="sort-label">
          Poredaj
        </span>
        <div class={s.segments} role="group" aria-labelledby="sort-label">
          <button type="button" class={s.segment} aria-pressed={sort === 'broj'} onClick={() => setSort('broj')}>
            Po broju
          </button>
          <button type="button" class={s.segment} aria-pressed={sort === 'rang'} onClick={() => setSort('rang')}>
            Po <span class={s.wide}>narodnom </span>rangu
          </button>
        </div>
      </div>
      <p class="visually-hidden" aria-live="polite">
        Prikazano: {radova(shown)}
      </p>
    </div>
  );
}
