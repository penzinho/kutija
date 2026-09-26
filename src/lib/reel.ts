/**
 * Flip-digit reel: each digit is a 0–9 strip shifted by -n × 1.1em (styles in global.css).
 * The same markup is rendered on the server (DigitReel.astro) and updated in the browser
 * (`setReel`), so a value change rolls the digits (--dur-reel, --ease-snap).
 */
const fmt = new Intl.NumberFormat('hr-HR');

const cellHtml = (ch: string) =>
  /\d/.test(ch)
    ? `<span class="nm-reel-cell"><span class="nm-reel-strip" style="--d:${ch}">${'0123456789'
        .split('')
        .map((d) => `<span>${d}</span>`)
        .join('')}</span></span>`
    : `<span class="nm-reel-cell">${ch}</span>`;

/** Inner markup of a `.nm-reel` element. */
export function reelHtml(value: number): string {
  const text = fmt.format(value);
  return `<span class="visually-hidden">${text}</span><span class="nm-reel-cells" aria-hidden="true">${[...text]
    .map(cellHtml)
    .join('')}</span>`;
}

/** Rolls an existing `.nm-reel` to a new value; rebuilds it when the digit count changes. */
export function setReel(el: HTMLElement, value: number): void {
  if (el.dataset.reel === String(value)) return;
  el.dataset.reel = String(value);
  const text = fmt.format(value);
  const cells = el.querySelectorAll<HTMLElement>('.nm-reel-cell');
  const label = el.querySelector('.visually-hidden');
  if (!label || cells.length !== text.length) {
    el.innerHTML = reelHtml(value);
    return;
  }
  label.textContent = text;
  [...text].forEach((ch, i) => {
    const strip = cells[i]!.querySelector<HTMLElement>('.nm-reel-strip');
    if (strip && /\d/.test(ch)) strip.style.setProperty('--d', ch);
    else cells[i]!.outerHTML = cellHtml(ch);
  });
}
