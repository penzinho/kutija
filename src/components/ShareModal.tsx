import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { top3Url } from '../lib/top3';
import { track } from '../lib/analytics';
import type { DuelEntry } from './Duel';
import s from './ShareModal.module.css';

interface Props {
  /** The top three, best first. */
  entries: DuelEntry[];
  played: number;
  onClose: () => void;
}

const CARD_W = 1200;
const TEXT = 'Moj top 3 za novi Maksimir. Žiri je odlučio, sad je red na narodu.';
const pad = (n: number) => String(n).padStart(2, '0');

/** "Moj top 3" after every 10th duel: the 1200×630 share card, scaled, plus share / continue. */
export default function ShareModal({ entries, played, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => clearTimeout(toastTimer.current);
  }, []);

  // The card is laid out at 1200 px and scaled to the frame width.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setScale(e.contentRect.width / CARD_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const say = (msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const url = top3Url(location.origin, entries.map((e) => e.id));

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Narodni Maksimir', text: TEXT, url });
        track('share', { method: 'native', content_type: 'top3' });
      } catch {
        // dismissed by the visitor
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      track('share', { method: 'clipboard', content_type: 'top3' });
      say('Poveznica kopirana');
    } catch {
      say('Kopiraj poveznicu iz preglednika');
    }
  };

  return (
    <dialog
      ref={dialog}
      class={s.dialog}
      aria-labelledby="share-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <div class={s.inner}>
        <div>
          <div class={s.eyebrow}>{played} dvoboja odigrano</div>
          <h2 id="share-title" class={s.title}>
            Tvoj top 3 je spreman
          </h2>
        </div>

        <div class={s.frame} ref={frame} style={{ aspectRatio: `${CARD_W} / 630` }}>
          <div class={s.card} style={{ transform: `scale(${scale})` }} role="img" aria-label={cardLabel(entries)}>
            <div class={s.cardText}>
              <div class={s.cardKicker}>✶ Narodni Maksimir</div>
              <div>
                <div class={s.cardTitle}>
                  Moj
                  <br />
                  top 3
                </div>
                <div class={s.cardLead}>Žiri je odlučio. Ja sam glasao.</div>
              </div>
              <div class={s.cardHost}>{location.host}/dvoboj</div>
            </div>
            <ol class={s.cardList}>
              {entries.map((e, i) => (
                <li key={e.id} class={s.cardRow}>
                  <span class={s.cardPlace}>{i + 1}</span>
                  <span class={s.cardThumb}>{e.img && <img src={e.img.src} alt="" decoding="async" />}</span>
                  <span>
                    <span class={s.cardRad}>Rad {pad(e.id)}</span>
                    <span class={s.cardCode}>{e.code}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div class={s.actions}>
          <button type="button" class={s.primary} onClick={share}>
            Podijeli
          </button>
          <button type="button" class={s.secondary} onClick={onClose} autofocus>
            Nastavi igrati
          </button>
        </div>
      </div>
      {toast && (
        <div class={s.toast} role="status">
          {toast}
        </div>
      )}
    </dialog>
  );
}

const cardLabel = (entries: DuelEntry[]) =>
  `Moj top 3: ${entries.map((e, i) => `${i + 1}. rad ${e.id}`).join(', ')}`;
