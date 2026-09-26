import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { getPair, voteDuel, type Pair, type VoteError, type DuelResult } from '../lib/vote';
import { loadSaved, saveSaved } from '../lib/store';
import { reducedMotion } from '../lib/motion';
import { bumpTotal, refreshRanks, subscribeRanks } from '../lib/live';
import type { Ranks } from '../lib/rank';
import s from './Duel.module.css';

/** What the island needs per entry; built at build time in src/pages/dvoboj.astro. */
export type DuelEntry = {
  id: number;
  code: string;
  award: number | null;
  /** Country name in Croatian, when known. */
  country: string | null;
  /** The people's rank as of the build; live ranks replace it. */
  rank: number | null;
  alt: string;
  img: { src: string; webp: string; avif: string } | null;
};

interface Props {
  entries: DuelEntry[];
  sizes: string;
}

type Side = 'a' | 'b';
type Blocked = 'no_pair' | 'daily_limit' | 'offline' | 'failed';
type Phase =
  | { kind: 'loading' }
  | { kind: 'idle' }
  /** Waiting for the next pair after a skip or a rejected token; the cards stay visible. */
  | { kind: 'switching' }
  /** Tapped, waiting for the server: the card is highlighted, nothing is celebrated yet. */
  | { kind: 'pending'; side: Side }
  /** The server recorded the vote: stamp, loser dimmed, FX. */
  | { kind: 'won'; side: Side }
  | { kind: 'blocked'; reason: Blocked; retryAfter?: number };

// SPECS motion table.
const HOLD = { normal: 720, reduced: 250 };
// A slow confirmation still gets this long to show the stamp before the next pair.
const MIN_WON = { normal: 450, reduced: 150 };
const PILL_MS = 1500;
const CONFETTI = 34;
// Server: one duel per 1.5 s per session. Sending no earlier avoids a needless 429.
const MIN_GAP_MS = 1600;
const SEGMENTS = 10;

const pad = (n: number) => String(n).padStart(2, '0');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'dvoboj' : 'dvoboja');
const isMobile = () => matchMedia('(max-width: 759px)').matches;

export default function Duel({ entries, sizes }: Props) {
  const byId = useRef(new Map(entries.map((e) => [e.id, e]))).current;

  const [pair, setPair] = useState<Pair | null>(null);
  const [next, setNext] = useState<Pair | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [played, setPlayed] = useState(0);
  const [rateUntil, setRateUntil] = useState(0);
  const [rateLeft, setRateLeft] = useState(0);
  const [offline, setOffline] = useState(false);
  const [pill, setPill] = useState<{ id: number; key: number } | null>(null);
  const [ranks, setRanks] = useState<Ranks | null>(null);

  const root = useRef<HTMLElement>(null);
  const prefetch = useRef<Promise<Pair | VoteError> | null>(null);
  const lastVoteAt = useRef(0);
  const pillTimer = useRef<ReturnType<typeof setTimeout>>();
  // Latest state for the async flows and the key handler.
  const live = useRef({ pair, phase, rateLeft });
  live.current = { pair, phase, rateLeft };

  const startPrefetch = () => {
    const p = getPair();
    prefetch.current = p;
    p.then((r) => {
      if (prefetch.current === p && r.ok) setNext(r);
    });
  };

  /** Shows a pair and starts fetching the one after it. Returns false if the flow stopped. */
  const show = (r: Pair | VoteError): boolean => {
    if (r.ok) {
      setPair(r);
      setNext(null);
      setPhase({ kind: 'idle' });
      startPrefetch();
      return true;
    }
    prefetch.current = null;
    setNext(null);
    switch (r.code) {
      case 'no_pair':
        setPhase({ kind: 'blocked', reason: 'no_pair' });
        break;
      case 'daily_limit':
        setPhase({ kind: 'blocked', reason: 'daily_limit', retryAfter: r.retry_after });
        break;
      case 'network':
        setPhase({ kind: 'blocked', reason: 'offline' });
        break;
      default:
        setPhase({ kind: 'blocked', reason: 'failed' });
    }
    return false;
  };

  /** The prefetched pair, or a fresh one if the prefetch failed or never started. */
  const advance = async () => {
    const pending = prefetch.current;
    prefetch.current = null;
    let r = pending ? await pending : await getPair();
    if (!r.ok && pending && r.code !== 'daily_limit' && r.code !== 'no_pair') r = await getPair();
    show(r);
  };

  /** First pair; `?a=id` pins one side. An unknown or excluded pin falls back to a random pair. */
  const start = async () => {
    setPhase({ kind: 'loading' });
    const pin = Number(new URLSearchParams(location.search).get('a'));
    let r = Number.isInteger(pin) && byId.has(pin) ? await getPair(pin) : await getPair();
    if (!r.ok && r.code === 'invalid_entry') r = await getPair();
    show(r);
  };

  useEffect(() => subscribeRanks(setRanks), []);

  useEffect(() => {
    setPlayed(loadSaved().played);
    start();
    void refreshRanks(2000);
    const onOnline = () => {
      setOffline(false);
      if (live.current.phase.kind === 'blocked' && live.current.phase.reason === 'offline') start();
    };
    addEventListener('online', onOnline);
    return () => {
      removeEventListener('online', onOnline);
      clearTimeout(pillTimer.current);
    };
  }, []);

  // Rate-limit countdown. Computed from the deadline, so a hidden tab needs no ticking.
  useEffect(() => {
    if (!rateUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((rateUntil - Date.now()) / 1000));
      setRateLeft(left);
      if (!left) setRateUntil(0);
    };
    tick();
    const id = setInterval(() => !document.hidden && tick(), 250);
    return () => clearInterval(id);
  }, [rateUntil]);

  /** Sends the vote no sooner than the server's per-session gap; retries a short 429 once. */
  const send = async (token: string, winner: number): Promise<DuelResult | VoteError> => {
    const wait = lastVoteAt.current + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    let r = await voteDuel(token, winner);
    if (!r.ok && r.code === 'rate_limited' && (r.retry_after ?? 0) <= 2) {
      await sleep((r.retry_after ?? 1) * 1000);
      r = await voteDuel(token, winner);
    }
    if (r.ok) lastVoteAt.current = Date.now();
    return r;
  };

  const vote = async (side: Side) => {
    const { pair: p, phase: ph, rateLeft: rl } = live.current;
    if (!p || ph.kind !== 'idle' || rl > 0) return;
    const winner = side === 'a' ? p.a : p.b;

    if (!navigator.onLine) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setPhase({ kind: 'pending', side });
    const reduced = reducedMotion();
    const tappedAt = Date.now();

    const r = await send(p.token, winner);

    if (r.ok) {
      // Celebrate only what the server recorded.
      setPhase({ kind: 'won', side });
      if (!reduced) burst(root.current, side);
      const saved = loadSaved(); // another tab may have played too
      const userWins = { ...saved.userWins, [winner]: (saved.userWins[winner] ?? 0) + 1 };
      saveSaved({ ...saved, played: saved.played + 1, userWins });
      setPlayed(saved.played + 1);
      bumpTotal();
      void refreshRanks(4000); // at most one leaderboard read per few votes
      clearTimeout(pillTimer.current);
      setPill({ id: winner, key: Date.now() });
      pillTimer.current = setTimeout(() => setPill(null), PILL_MS);
      const hold = reduced ? HOLD.reduced : HOLD.normal;
      await sleep(Math.max(hold - (Date.now() - tappedAt), reduced ? MIN_WON.reduced : MIN_WON.normal));
      await advance();
      return;
    }

    switch (r.code) {
      case 'rate_limited':
        setPhase({ kind: 'idle' });
        setRateUntil(Date.now() + (r.retry_after ?? 5) * 1000);
        break;
      case 'network':
        setPhase({ kind: 'idle' });
        setOffline(true);
        break;
      case 'daily_limit':
        show(r);
        break;
      case 'invalid_token':
      case 'expired_token':
      case 'wrong_session':
      case 'already_judged':
      case 'invalid_entry':
        // The pair is gone server-side (expired, or the session was renewed): just move on.
        setPhase({ kind: 'switching' });
        await advance();
        break;
      default:
        show(r);
    }
  };

  const skip = async () => {
    const { phase: ph, rateLeft: rl } = live.current;
    if (ph.kind !== 'idle' || rl > 0) return;
    setOffline(false);
    setPhase({ kind: 'switching' });
    await advance();
  };

  // Keyboard: ← / → vote, Space / ↓ skip. Space on a focused button keeps its native meaning.
  const keys = useRef({ vote, skip });
  keys.current = { vote, skip };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const onControl = !!t.closest('button, a');
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        keys.current.vote(e.key === 'ArrowLeft' ? 'a' : 'b');
      } else if (e.key === 'ArrowDown' || (e.key === ' ' && !onControl)) {
        e.preventDefault();
        keys.current.skip();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Next pair slides in (±70 px X on desktop, ±30 px Y on mobile).
  useLayoutEffect(() => {
    if (!pair || reducedMotion() || !root.current) return;
    const mob = isMobile();
    root.current.querySelectorAll<HTMLElement>('[data-duel-card]').forEach((el) => {
      const d = el.dataset.duelCard === 'a' ? -1 : 1;
      el.animate(
        [{ transform: mob ? `translateY(${d * 30}px)` : `translateX(${d * 70}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    });
  }, [pair?.token]);

  const inSet = played > 0 && played % SEGMENTS === 0 ? SEGMENTS : played % SEGMENTS;
  const toGo = SEGMENTS - inSet || SEGMENTS;
  const locked = rateLeft > 0;
  const won = phase.kind === 'won' ? phase.side : null;
  const picked = phase.kind === 'pending' ? phase.side : null;
  const showCards = pair && phase.kind !== 'loading' && phase.kind !== 'blocked';

  return (
    <section class={s.duel} ref={root} aria-labelledby="duel-title">
      <div class={s.head}>
        <div>
          <div class={s.eyebrow}>Dvoboj · tvoj glas</div>
          <h1 id="duel-title" class={s.title}>
            Koji je bolji?
          </h1>
        </div>
        <div class={s.progress}>
          <div class={s.progressRow}>
            <span class={s.played}>
              Odigrao si <Reel value={played} /> {plural(played)}
            </span>
            <span class={s.toGo}>još {toGo} do top 3</span>
          </div>
          <div class={s.segments} aria-hidden="true">
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span class={i < inSet ? s.segOn : s.seg} />
            ))}
          </div>
        </div>
      </div>

      {locked && (
        <div class={s.banner} role="alert">
          <span class={s.bannerIcon} aria-hidden="true">
            !
          </span>
          <div>
            <div class={s.bannerTitle}>Previše glasova, pričekaj trenutak</div>
            <div class={s.bannerText}>Štitimo glasanje od botova. Možeš ponovno za {rateLeft} s.</div>
          </div>
        </div>
      )}
      {offline && !locked && (
        <div class={s.banner} role="alert">
          <span class={s.bannerIcon} aria-hidden="true">
            !
          </span>
          <div>
            <div class={s.bannerTitle}>Nema veze</div>
            <div class={s.bannerText}>Glas nije zabilježen. Provjeri internet pa izaberi ponovno.</div>
          </div>
        </div>
      )}

      {phase.kind === 'blocked' ? (
        <BlockedState reason={phase.reason} retryAfter={phase.retryAfter} onRetry={start} />
      ) : (
        <>
          <div class={s.stage} aria-busy={!showCards}>
            {(['a', 'b'] as const).map((side) => {
              const e = showCards ? byId.get(side === 'a' ? pair.a : pair.b) : undefined;
              if (!e) return <div key={side} class={s.skeleton} data-duel-card={side} aria-hidden="true" />;
              const state = won === side ? 'chosen' : won ? 'loser' : picked === side ? 'picked' : undefined;
              const disabled = phase.kind !== 'idle' || locked;
              return (
                <Card
                  key={side}
                  side={side}
                  entry={e}
                  rank={ranks?.get(e.id)?.rank ?? e.rank}
                  sizes={sizes}
                  state={state}
                  disabled={disabled}
                  onVote={() => vote(side)}
                />
              );
            })}
            <div class={s.vs} data-vs aria-hidden="true">
              VS
            </div>
          </div>

          <div class={s.actions}>
            <span class={s.hintDesk}>
              Tipke <span class={s.hintKeys}>← / →</span> za glas
            </span>
            <span class={s.hintMob}>Dodirni rad koji ti je bolji</span>
            <button
              type="button"
              class={s.skip}
              onClick={skip}
              aria-disabled={phase.kind !== 'idle' || locked}
            >
              Preskoči <span class={s.skipKey}>razmak</span>
            </button>
            {pill && (
              <span key={pill.key} class={s.pill}>
                <span class={s.pillCheck} aria-hidden="true">
                  ✓
                </span>
                Glas zabilježen · Rad {pad(pill.id)}
              </span>
            )}
          </div>
        </>
      )}

      <p class="visually-hidden" aria-live="polite">
        {pill ? `Glas zabilježen za rad ${pill.id}.` : ''}
        {showCards && phase.kind === 'idle' ? ` Novi dvoboj: rad ${pair.a} protiv rada ${pair.b}.` : ''}
      </p>

      {/* Warms the cache for the prefetched pair: same <picture> and sizes, so the same file. */}
      {next && (
        <div class={s.preload} aria-hidden="true">
          {[next.a, next.b].map((id) => {
            const e = byId.get(id);
            return e?.img && <Picture key={id} entry={e} sizes={sizes} eager />;
          })}
        </div>
      )}
    </section>
  );
}

function Card(props: {
  side: Side;
  entry: DuelEntry;
  rank: number | null;
  sizes: string;
  state?: 'picked' | 'chosen' | 'loser';
  disabled: boolean;
  onVote: () => void;
}) {
  const { side, entry: e, rank, sizes, state, disabled, onVote } = props;
  const num = pad(e.id);
  const sub = [e.country, rank ? `Narod #${rank}` : null].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      class={s.card}
      data-duel-card={side}
      data-state={state}
      aria-disabled={disabled}
      aria-label={`Glasaj za rad ${num}${e.award ? `, ${e.award}. nagrada žirija` : ''}`}
      onClick={() => !disabled && onVote()}
    >
      <div class={s.media}>
        {e.img ? <Picture entry={e} sizes={sizes} eager /> : <div class={s.missing} />}
        <div class={s.scrim} />
        <div class={s.top}>
          <span class={s.code}>{e.code}</span>
          {e.award && (
            <span class={s.award} data-tier={e.award}>
              <span class={s.awardNum}>{e.award}.</span>nagrada
            </span>
          )}
        </div>
        <div class={s.num}>{num}</div>
        {state === 'chosen' && (
          <div class={s.stampWrap}>
            <span class={s.stamp}>Pobjeda</span>
          </div>
        )}
      </div>
      <div class={s.meta}>
        <div class={s.metaText}>
          <div class={s.metaTitle}>Rad {num}</div>
          {sub && <div class={s.metaSub}>{sub}</div>}
        </div>
        <span class={s.kbd} aria-hidden="true">
          {side === 'a' ? '←' : '→'}
        </span>
      </div>
    </button>
  );
}

function Picture({ entry, sizes, eager }: { entry: DuelEntry; sizes: string; eager?: boolean }) {
  const img = entry.img!;
  return (
    <picture>
      <source type="image/avif" srcset={img.avif} sizes={sizes} />
      <img
        class={s.img}
        src={img.src}
        srcset={img.webp}
        sizes={sizes}
        alt={entry.alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </picture>
  );
}

function BlockedState({ reason, retryAfter, onRetry }: { reason: Blocked; retryAfter?: number; onRetry: () => void }) {
  const hours = retryAfter ? Math.max(1, Math.round(retryAfter / 3600)) : null;
  const copy: Record<Blocked, { numeral: string; title: string; text: string }> = {
    no_pair: {
      numeral: '0',
      title: 'Odigrao si sve parove',
      text: 'Za tebe više nema novih dvoboja. Hvala na glasovima!',
    },
    daily_limit: {
      numeral: '0',
      title: 'Za danas je dosta',
      text: hours ? `Potrošio si dnevne glasove. Novi dvoboji za otprilike ${hours} h.` : 'Potrošio si dnevne glasove. Vrati se sutra.',
    },
    offline: { numeral: '!', title: 'Nema veze', text: 'Provjeri internet pa pokušaj ponovno.' },
    failed: { numeral: '!', title: 'Nešto je zapelo', text: 'Glasanje trenutno ne radi. Pokušaj ponovno za trenutak.' },
  };
  const c = copy[reason];
  const retry = reason === 'offline' || reason === 'failed';
  return (
    <div class={s.empty} role={retry ? 'alert' : undefined}>
      <span class={s.emptyNum} aria-hidden="true">
        {c.numeral}
      </span>
      <h2 class={s.emptyTitle}>{c.title}</h2>
      <p class={s.emptyText}>{c.text}</p>
      {retry ? (
        <button type="button" class={s.cta} onClick={onRetry}>
          Pokušaj ponovno
        </button>
      ) : reason === 'no_pair' ? (
        <a class={s.cta} href="/rang">
          Pogledaj rang →
        </a>
      ) : (
        <a class={s.cta} href="/">
          Pregledaj radove →
        </a>
      )}
    </div>
  );
}

/** Flip-digit reel (same look as DigitReel.astro), for values that change on the client. */
function Reel({ value }: { value: number }) {
  const text = String(value);
  return (
    <span class={s.reel}>
      <span class="visually-hidden">{text}</span>
      <span class={s.reelCells} aria-hidden="true">
        {[...text].map((ch, i) => (
          <span key={text.length - i} class={s.reelCell}>
            <span class={s.reelStrip} style={{ '--d': ch }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** Win FX: flash over the chosen card, ≤34 confetti bits (removed when done), VS pulse. */
function burst(root: HTMLElement | null, side: Side) {
  const card = root?.querySelector<HTMLElement>(`[data-duel-card="${side}"]`);
  if (!card) return;
  const r = card.getBoundingClientRect();

  const flash = document.createElement('div');
  flash.className = s.flash;
  Object.assign(flash.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(flash);
  flash.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'forwards' }).onfinish =
    () => flash.remove();

  const cx = r.left + r.width / 2;
  const cy = r.top + r.height * 0.42;
  for (let i = 0; i < CONFETTI; i++) {
    const bit = document.createElement('div');
    const size = 5 + Math.random() * 7;
    bit.className = s.confetti;
    Object.assign(bit.style, {
      left: `${cx}px`,
      top: `${cy}px`,
      width: `${size}px`,
      height: `${size * (i % 2 ? 0.45 : 1)}px`,
      background: `var(--c-confetti-${(i % 4) + 1})`,
      borderRadius: i % 3 ? '1px' : '50%',
    });
    document.body.append(bit);
    const angle = Math.random() * Math.PI * 2;
    const dist = 100 + Math.random() * Math.min(260, r.width * 0.6);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60;
    bit.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px,${dy + 150}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' },
    ).onfinish = () => bit.remove();
  }

  root
    ?.querySelector('[data-vs]')
    // `scale`, not `transform`: the badge's position transform differs on mobile.
    ?.animate([{ scale: '1' }, { scale: '1.35' }, { scale: '1' }], { duration: 440, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}
