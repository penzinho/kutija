/**
 * "Back" on an entry page returns to the page the visitor opened it from (gallery,
 * rang, brojke…), not always the home page. Paging prev/next between entries keeps
 * that origin. When the origin is still in this tab's history we step back to it,
 * so ClientRouter restores its scroll position; otherwise we link to it.
 */

type Spot = { url: string; index?: number };
type Last = Spot & { entry: boolean };

const LAST_KEY = 'nd:last-page';
const ORIGINS_KEY = 'nd:entry-origins';

const LABELS: Record<string, string> = {
  '/': 'Svi radovi',
  '/dvoboj': 'Dvoboj',
  '/rang': 'Rang lista',
  '/brojke': 'Brojke',
  '/o-projektu': 'O projektu',
};

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the back link keeps its default */
  }
}

function historyIndex(): number | undefined {
  const i = (history.state as { index?: unknown } | null)?.index;
  return typeof i === 'number' ? i : undefined;
}

function isEntry(pathname: string): boolean {
  return pathname.startsWith('/rad/');
}

/** Call on every `astro:page-load`. Binds `[data-back]` on entry pages. */
export function trackReturnTo(): void {
  const here: Last = {
    url: location.pathname + location.search + location.hash,
    index: historyIndex(),
    entry: isEntry(location.pathname),
  };
  const last = read<Last>(LAST_KEY);
  write(LAST_KEY, here);
  if (!here.entry) return;

  const origins = read<Record<string, Spot>>(ORIGINS_KEY) ?? {};
  const key = String(here.index);
  let origin: Spot | undefined;

  // Arrived by a fresh step from the previous page: derive the origin from it.
  // Otherwise (reload, browser back/forward) reuse what this history slot had.
  const freshStep = last && (here.index === undefined || last.index === here.index - 1);
  if (freshStep && last) {
    origin = last.entry ? origins[String(last.index)] : { url: last.url, index: last.index };
  } else {
    origin = origins[key];
  }
  if (here.index !== undefined) {
    if (origin) origins[key] = origin;
    else delete origins[key];
    write(ORIGINS_KEY, origins);
  }

  const link = document.querySelector<HTMLAnchorElement>('[data-back]');
  if (!link || !origin) return;
  const target = origin;
  const path = new URL(target.url, location.origin).pathname.replace(/\/$/, '') || '/';

  link.href = target.url;
  const label = link.querySelector('[data-back-label]');
  if (label) label.textContent = LABELS[path] ?? 'Natrag';

  link.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const now = historyIndex();
    if (target.index === undefined || now === undefined || now <= target.index) return;
    e.preventDefault();
    history.go(target.index - now);
  });
}
