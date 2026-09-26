import { formatNumber } from '../lib/rank';

/**
 * Flip-digit reel for islands: the same markup and global styles as DigitReel.astro
 * (src/lib/reel.ts). Cells are keyed from the right, so a changed digit rolls.
 */
export default function Reel({ value }: { value: number }) {
  const text = formatNumber(value);
  return (
    <span class="nm-reel">
      <span class="visually-hidden">{text}</span>
      <span class="nm-reel-cells" aria-hidden="true">
        {[...text].map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={text.length - i} class="nm-reel-cell">
              <span class="nm-reel-strip" style={{ '--d': ch }}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={text.length - i} class="nm-reel-cell">
              {ch}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
