import { useEffect, useState } from 'preact/hooks';
import { loadSaved, setFavorite } from '../lib/store';
import { setFavoriteRemote, type VoteError } from '../lib/vote';
import { refreshRanks } from '../lib/live';
import s from './FavoriteButton.module.css';

interface Props {
  id: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function errorText(e: VoteError): string {
  switch (e.code) {
    case 'daily_limit':
      return 'S ove mreže je danas odabrano previše favorita. Pokušaj opet sutra.';
    case 'rate_limited':
      return 'Previše promjena odjednom. Pričekaj trenutak pa pokušaj opet.';
    case 'network':
    case 'session_failed':
      return 'Nije uspjelo. Provjeri vezu i pokušaj opet.';
    default:
      return 'Nešto je pošlo po zlu. Pokušaj opet malo kasnije.';
  }
}

/**
 * "Ovo je moj favorit" toggle. One favorite per visitor (D9): picking this one replaces the
 * old one. The server (`set_favorite`) holds the vote; localStorage only mirrors it.
 */
export default function FavoriteButton({ id }: Props) {
  const [fav, setFav] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const read = () => setFav(loadSaved().fav);
    read();
    // Another tab picked a favorite.
    addEventListener('storage', read);
    return () => removeEventListener('storage', read);
  }, []);

  const on = fav === id;

  const toggle = async () => {
    if (busy) return;
    const next = on ? null : id;
    setBusy(true);
    setError('');
    setStatus('Spremam…');
    const r = await setFavoriteRemote(next);
    setBusy(false);
    if (!r.ok) {
      setStatus('');
      setError(errorText(r));
      return;
    }
    setFav(setFavorite(r.entry).fav);
    setStatus(r.entry === null ? 'Uklonjeno iz favorita' : `Rad ${pad(id)} je tvoj favorit`);
    void refreshRanks(); // the favorites count on this page
  };

  return (
    <>
      <button type="button" class={s.fav} aria-pressed={on} aria-busy={busy} onClick={toggle}>
        <span class={s.icon} aria-hidden="true">
          {on ? '★' : '☆'}
        </span>
        {on ? 'Tvoj favorit' : 'Ovo je moj favorit'}
      </button>
      {fav !== null && !on && !error && (
        <p class={s.note}>
          Tvoj favorit je <a href={`/rad/${fav}`}>Rad {pad(fav)}</a>. Možeš imati samo jedan, pa bi ovaj zamijenio
          njega.
        </p>
      )}
      {error && (
        <p class={`${s.note} ${s.error}`} role="alert">
          {error}
        </p>
      )}
      <p class="visually-hidden" aria-live="polite">
        {status}
      </p>
    </>
  );
}
