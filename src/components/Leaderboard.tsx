import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { poll, refreshRanks, subscribeRanks } from '../lib/live';
import { formatNumber, rankDelta, winRate, type RankInfo, type Ranks } from '../lib/rank';
import { juryGap, type JuryBand } from '../lib/jury';
import { reducedMotion } from '../lib/motion';
import Reel from './Reel';
import s from './Leaderboard.module.css';

/** What the island needs per entry; built at build time in src/pages/rang.astro. */
export type BoardEntry = {
  id: number;
  code: string;
  award: number | null;
  /** The jury's verdict in a few words ("3. nagrada", "Ispao u 2. krugu"). */
  jury: string;
  /** Places in the jury's order; null for excluded entries (never ranked). */
  band: JuryBand | null;
  /** Small WebP for the table row. */
  thumb: string | null;
  /** Wide WebP behind the hero picks. */
  cover: string | null;
};

interface Props {
  entries: BoardEntry[];
  /** Build-time snapshot; the island polls the live leaderboard. */
  ranks: [number, RankInfo][];
}

const TOP = 20;
/** Below this many duels the order is mostly noise: no disagreement cards or highlights yet. */
const MIN_DUELS = 50;
/** Rows where the people and the jury are at least this many places apart are highlighted. */
const DISAGREE = 15;
const DISAGREE_CARDS = 5;
// SPECS motion table: leaderboard FLIP + blue flash, 760 ms, --ease-out.
const FLIP = { duration: 760, easing: 'cubic-bezier(.2,.8,.2,1)' };

const pad = (n: number) => String(n).padStart(2, '0');
/** 1 mjesto, 2 mjesta, 5 mjesta, 21 mjesto. */
const places = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'mjesto' : 'mjesta'}`;
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export default function Leaderboard({ entries, ranks: initial }: Props) {
  const [ranks, setRanks] = useState<Ranks>(() => new Map(initial));
  const [showAll, setShowAll] = useState(false);
  const rowEls = useRef(new Map<number, HTMLElement>());
  // Row tops before a live update, for FLIP.
  const before = useRef<Map<number, number> | null>(null);

  useEffect(() => {
    const off = subscribeRanks((next) => {
      if (!reducedMotion()) {
        before.current = new Map([...rowEls.current].map(([id, el]) => [id, el.getBoundingClientRect().top]));
      }
      setRanks(next);
    });
    const stop = poll(() => void refreshRanks());
    return () => {
      off();
      stop();
    };
  }, []);

  // FLIP: rows start where they were and glide to their new place, with a blue flash.
  useLayoutEffect(() => {
    const tops = before.current;
    before.current = null;
    if (!tops) return;
    for (const [id, el] of rowEls.current) {
      const top = tops.get(id);
      if (top === undefined) continue;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], FLIP);
      el.querySelector('[data-flash]')?.animate([{ opacity: 1 }, { opacity: 0 }], FLIP);
    }
  }, [ranks]);

  const ordered = useMemo(() => {
    const rank = (id: number) => ranks.get(id)?.rank ?? Infinity;
    // Ranked first; entries without data next; excluded entries last, never ranked.
    return [...entries].sort(
      (a, b) => rank(a.id) - rank(b.id) || Number(!a.band) - Number(!b.band) || a.id - b.id,
    );
  }, [entries, ranks]);

  // Every duel counts for two entries (same as the `stats` view).
  const totalDuels = [...ranks.values()].reduce((sum, r) => sum + r.duels, 0) / 2;
  const settled = totalDuels >= MIN_DUELS;
  const trackEnd = entries.filter((e) => e.band).length;

  const gapOf = (e: BoardEntry) => {
    const r = ranks.get(e.id);
    return e.band && r ? juryGap(e.band, r.rank) : 0;
  };

  const juryPick = entries.find((e) => e.award === 1)!;
  const juryRank = ranks.get(juryPick.id)?.rank;
  const peoplePick = totalDuels > 0 && ranks.has(ordered[0]!.id) ? ordered[0]! : null;

  const disagreements = settled
    ? ordered
        .filter((e) => gapOf(e) !== 0)
        .sort((a, b) => Math.abs(gapOf(b)) - Math.abs(gapOf(a)) || a.id - b.id)
        .slice(0, DISAGREE_CARDS)
    : [];

  const rows = showAll ? ordered : ordered.slice(0, TOP);

  return (
    <div class={s.board}>
      <div class={s.picks} data-reveal="2">
        <a href={`/rad/${juryPick.id}`} class={`${s.pick} ${s.pickJury}`}>
          {juryPick.cover && <img class={s.pickImg} src={juryPick.cover} alt="" decoding="async" />}
          <span class={s.pickLabel}>Izbor žirija</span>
          <span>
            <span class={s.pickNum}>Rad {pad(juryPick.id)}</span>
            <span class={s.pickNote}>
              1. nagrada · kod naroda{' '}
              {juryRank ? (
                <>
                  {juryRank === 1 ? 'također' : 'tek'} <strong>#{juryRank}</strong>
                </>
              ) : (
                '—'
              )}
            </span>
          </span>
        </a>
        {peoplePick ? (
          <a href={`/rad/${peoplePick.id}`} class={`${s.pick} ${s.pickPeople}`}>
            {peoplePick.cover && <img key={peoplePick.id} class={s.pickImg} src={peoplePick.cover} alt="" decoding="async" />}
            <span class={s.pickLabel}>Izbor naroda · #1</span>
            <span>
              <span class={s.pickNum}>Rad {pad(peoplePick.id)}</span>
              <span class={s.pickNote}>Žiri: {lowerFirst(peoplePick.jury)}</span>
            </span>
          </a>
        ) : (
          <a href="/dvoboj" class={`${s.pick} ${s.pickPeople}`}>
            <span class={s.pickLabel}>Izbor naroda · #1</span>
            <span>
              <span class={s.pickNum}>Još nitko</span>
              <span class={s.pickNote}>Narod još nije glasao. Odigraj prvi dvoboj →</span>
            </span>
          </a>
        )}
      </div>

      <h2 class={s.h2} data-reveal="0">
        Najveća neslaganja
      </h2>
      {settled ? (
        disagreements.length ? (
          <div class={s.cards}>
            {disagreements.map((e, i) => (
              <DisagreeCard key={e.id} entry={e} rank={ranks.get(e.id)!.rank} gap={gapOf(e)} end={trackEnd} stagger={i} />
            ))}
          </div>
        ) : (
          <p class={s.note}>Zasad se narod slaže sa žirijem: svaki rad je unutar skupine koju mu je dodijelio žiri.</p>
        )
      ) : (
        <p class={s.note}>
          Neslaganja pokazujemo kad narod odigra prvih {MIN_DUELS} dvoboja. Do tada je rang premalo pouzdan.{' '}
          {totalDuels < MIN_DUELS && <>Još {Math.ceil(MIN_DUELS - totalDuels)}.</>}
        </p>
      )}

      <div class={s.tableHead}>
        <h2 class={s.h2}>Ljestvica</h2>
        {settled && (
          <p class={s.legend}>
            <span class={s.legendMark} aria-hidden="true" />
            Narod i žiri razilaze se za {DISAGREE} ili više mjesta
          </p>
        )}
      </div>
      <div class={s.table}>
        <div class={s.head} aria-hidden="true">
          <span>Narod</span>
          <span>24 h</span>
          <span>Rad</span>
          <span>Žiri</span>
          <span class={s.right}>Ocjena</span>
          <span class={s.right}>Dvoboji</span>
          <span class={s.right}>Favoriti</span>
          <span class={s.right}>Pobjede</span>
        </div>
        <ol class={s.rows} id="ljestvica">
          {rows.map((e) => (
            <li key={e.id}>
              <Row
                entry={e}
                rank={ranks.get(e.id)}
                gap={settled ? gapOf(e) : 0}
                rowRef={(el) => (el ? rowEls.current.set(e.id, el) : rowEls.current.delete(e.id))}
              />
            </li>
          ))}
        </ol>
      </div>
      <div class={s.more}>
        <button type="button" class={s.moreBtn} aria-expanded={showAll} aria-controls="ljestvica" onClick={() => setShowAll((v) => !v)}>
          {showAll ? `Prikaži top ${TOP}` : `Prikaži svih ${entries.length}`}
        </button>
      </div>
    </div>
  );
}

function DisagreeCard({ entry: e, rank, gap, end, stagger }: { entry: BoardEntry; rank: number; gap: number; end: number; stagger: number }) {
  // The jury marker sits on the edge of its band nearest to the people's rank.
  const jury = gap > 0 ? e.band!.lo : e.band!.hi;
  const pos = (n: number) => `${(((n - 1) / (end - 1)) * 100).toFixed(1)}%`;
  const [lo, hi] = [Math.min(jury, rank), Math.max(jury, rank)];
  const up = gap > 0;
  return (
    <a href={`/rad/${e.id}`} class={s.card} data-reveal={stagger}>
      <span class={s.cardTop}>
        <span>
          <span class={s.cardTitle}>Rad {pad(e.id)}</span>
          <span class={s.cardSub}>
            {e.jury} → narod #{rank}
          </span>
        </span>
        <span class={s.cardBig} data-up={up}>
          <span aria-hidden="true">{up ? `+${gap}` : `−${-gap}`}</span>
        </span>
      </span>
      <span class={s.track} aria-hidden="true">
        <span class={s.trackLine} />
        <span class={s.trackSpan} data-up={up} style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
        <span class={`${s.marker} ${s.markerJury}`} style={{ left: pos(jury) }} title="Žiri">
          Ž
        </span>
        <span class={`${s.marker} ${s.markerPeople}`} style={{ left: pos(rank) }} title="Narod">
          N
        </span>
      </span>
      <span class={s.trackLabels}>
        <span aria-hidden="true">#1</span>
        <span>{up ? `narod ga diže ${places(gap)}` : `narod ga spušta ${places(-gap)}`}</span>
        <span aria-hidden="true">#{end}</span>
      </span>
    </a>
  );
}

function Row({ entry: e, rank: r, gap, rowRef }: { entry: BoardEntry; rank: RankInfo | undefined; gap: number; rowRef: (el: HTMLElement | null) => void }) {
  const d = rankDelta(r);
  const flagged = Math.abs(gap) >= DISAGREE;
  const label = [
    `Rad ${pad(e.id)}`,
    r ? `narod #${r.rank}` : e.band ? 'narod: još bez ranga' : 'nije u glasanju',
    `žiri: ${lowerFirst(e.jury)}`,
    ...(r ? [`ocjena ${formatNumber(r.elo)}`, d.label] : []),
    ...(flagged ? [gap > 0 ? `narod ga diže ${places(gap)}` : `narod ga spušta ${places(-gap)}`] : []),
  ].join(', ');

  return (
    <a
      href={`/rad/${e.id}`}
      ref={rowRef}
      class={s.row}
      data-awarded={e.award !== null || undefined}
      data-flagged={flagged ? (gap > 0 ? 'up' : 'down') : undefined}
      aria-label={label}
    >
      <span class={s.flash} data-flash aria-hidden="true" />
      <span class={s.rank} aria-hidden="true">
        {r ? <Reel value={r.rank} /> : '—'}
      </span>
      <span class={`${s.delta} ${s.wide}`} data-trend={d.trend} aria-hidden="true">
        {r ? d.text : ''}
      </span>
      <span class={s.entry} aria-hidden="true">
        <span class={s.thumb}>
          {e.thumb && <img src={e.thumb} alt="" width={56} height={38} loading="lazy" decoding="async" />}
        </span>
        <span class={s.name}>
          <span class={s.rad}>Rad {pad(e.id)}</span>
          <span class={s.code}>
            {e.code}
            <span class={s.narrow}> · {e.jury.replace(/^Ispao u (\d)\. krugu$/, '$1. krug')}</span>
          </span>
        </span>
      </span>
      <span class={`${s.jury} ${s.wide}`} data-muted={e.award === null || undefined} aria-hidden="true">
        {e.jury}
        {flagged && (
          <span class={s.gap} data-up={gap > 0}>
            {gap > 0 ? `▲ ${gap}` : `▼ ${-gap}`}
          </span>
        )}
      </span>
      <span class={`${s.num} ${s.wide}`} aria-hidden="true">
        {r ? formatNumber(r.elo) : '—'}
      </span>
      <span class={`${s.num} ${s.dim} ${s.wide}`} aria-hidden="true">
        {r ? formatNumber(r.duels) : '—'}
      </span>
      <span class={`${s.num} ${s.dim} ${s.wide}`} aria-hidden="true">
        {r ? formatNumber(r.favorites) : '—'}
      </span>
      <span class={`${s.num} ${s.dim} ${s.wide}`} aria-hidden="true">
        {r ? winRate(r) : '—'}
      </span>
      <span class={`${s.num} ${s.narrow}`} aria-hidden="true">
        <span class={s.block}>{r ? formatNumber(r.elo) : '—'}</span>
        <span class={`${s.block} ${s.delta}`} data-trend={d.trend}>
          {r ? d.text : ''}
        </span>
      </span>
    </a>
  );
}
