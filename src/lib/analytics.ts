/**
 * Google Analytics 4, only after consent (GDPR / ePrivacy: GA sets cookies). Until the
 * visitor accepts, gtag.js is not even requested. Without PUBLIC_GA_ID everything here
 * is a no-op and the consent banner never shows.
 *
 * Page views are sent by hand on every `astro:page-load`, because ClientRouter swaps
 * pages without a full load.
 */

const GA_ID = import.meta.env.PUBLIC_GA_ID ?? '';
export const analyticsEnabled = /^G-[A-Z0-9]+$/.test(GA_ID);

const CONSENT_KEY = 'nm-consent';
export type Consent = 'granted' | 'denied';

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let loaded = false;

export function getConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

function storeConsent(c: Consent) {
  try {
    localStorage.setItem(CONSENT_KEY, c);
  } catch {
    // blocked storage: the choice holds for this page view only
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads the `arguments` object, not an array: keep the classic function form.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  const g = window.gtag;
  g('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
  g('js', new Date());
  g('config', GA_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.append(s);
}

/** Removes GA's first-party cookies (_ga, _ga_<id>) after consent is withdrawn. */
function clearCookies() {
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]!.trim();
    if (!name.startsWith('_ga')) continue;
    for (const d of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
    }
  }
}

function pageView() {
  window.gtag?.('event', 'page_view', {
    page_location: location.href,
    page_path: location.pathname + location.search,
    page_title: document.title,
  });
}

/** Records the choice; accepting loads GA and counts the current page. */
export function setConsent(c: Consent) {
  storeConsent(c);
  if (c === 'granted') {
    if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    load();
    pageView();
  } else if (loaded) {
    window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
    clearCookies();
  } else {
    clearCookies();
  }
}

/** Call on every `astro:page-load`: counts the page when the visitor has accepted. */
export function onPageLoad() {
  if (!analyticsEnabled || getConsent() !== 'granted') return;
  load();
  pageView();
}

/** A custom GA event; dropped unless the visitor has accepted. */
export function track(name: string, params: Record<string, string | number> = {}) {
  if (!analyticsEnabled || !loaded || getConsent() !== 'granted') return;
  window.gtag?.('event', name, params);
}
