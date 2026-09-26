import { useEffect, useState } from 'preact/hooks';
import { loadSaved, setFavorite } from '../lib/store';
import s from './FavoriteButton.module.css';

interface Props {
  id: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Ovo je moj favorit" toggle. One favorite per visitor (D9): picking this one replaces the old one. */
export default function FavoriteButton({ id }: Props) {
  const [fav, setFav] = useState<number | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const read = () => setFav(loadSaved().fav);
    read();
    // Another tab picked a favorite.
    addEventListener('storage', read);
    return () => removeEventListener('storage', read);
  }, []);

  const on = fav === id;

  const toggle = () => {
    const next = on ? null : id;
    setFav(setFavorite(next).fav);
    setStatus(on ? 'Uklonjeno iz favorita' : `Rad ${pad(id)} je tvoj favorit`);
  };

  return (
    <>
      <button type="button" class={s.fav} aria-pressed={on} onClick={toggle}>
        <span class={s.icon} aria-hidden="true">
          {on ? '★' : '☆'}
        </span>
        {on ? 'Tvoj favorit' : 'Ovo je moj favorit'}
      </button>
      {fav !== null && !on && (
        <p class={s.note}>
          Tvoj favorit je <a href={`/rad/${fav}`}>Rad {pad(fav)}</a>. Možeš imati samo jedan, pa bi ovaj zamijenio
          njega.
        </p>
      )}
      <p class="visually-hidden" aria-live="polite">
        {status}
      </p>
    </>
  );
}
