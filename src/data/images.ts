import type { ImageMetadata, ImageOutputFormat } from 'astro';
import type { Entry } from './entries';

// Masters written by scripts/import-images.ts; entries.json refers to them by file name.
const files = import.meta.glob<{ default: ImageMetadata }>('../assets/entries/*.jpg', { eager: true });
const byName = new Map(Object.entries(files).map(([p, m]) => [p.slice(p.lastIndexOf('/') + 1), m.default]));

/** All images of an entry, in gallery order. Throws (and fails the build) on a missing file. */
export function entryImages(e: Entry): ImageMetadata[] {
  return e.images.map((name) => {
    const img = byName.get(name);
    if (!img) throw new Error(`entry ${e.id}: image "${name}" is not in src/assets/entries/`);
    return img;
  });
}

/** The card/cover image, or undefined when the entry has none (show the placeholder). */
export function coverImage(e: Entry): ImageMetadata | undefined {
  return entryImages(e)[0];
}

/** `Rad {id} · {code} · {authors}`; the authors part is left out while they are unknown. */
export function imageAlt(e: Entry): string {
  return [`Rad ${e.id}`, e.code, ...(e.authors.length ? [e.authors.join(', ')] : [])].join(' · ');
}

// `width` sizes the <img> fallback src; without it the full-size master would be emitted.
// AVIF <source> with a WebP <img> fallback: every current browser gets one of the two,
// and skipping a JPEG srcset halves the build output.
type Preset = {
  width: number;
  widths: number[];
  sizes: string;
  formats: ImageOutputFormat[];
  fallbackFormat: ImageOutputFormat;
};

/** Responsive presets for <Picture>. Widths cover 1x–2x of each layout slot. */
export const IMAGE_PRESETS = {
  // Grid card, 4:3; ~300 px wide on desktop (4 columns), half the width on phones (2 columns).
  card: {
    width: 640,
    widths: [320, 480, 640, 960],
    sizes: '(max-width: 760px) 50vw, (max-width: 1320px) 25vw, 330px',
    formats: ['avif'],
    fallbackFormat: 'webp',
  },
  // Awarded grid card: 2×2 on desktop, full width at 16:10 on phones.
  featured: {
    width: 960,
    widths: [480, 640, 960, 1280],
    sizes: '(max-width: 760px) 100vw, (max-width: 1320px) 50vw, 660px',
    formats: ['avif'],
    fallbackFormat: 'webp',
  },
  // Hero stack card, 4:5 crop; 70% of a 480 px stack on desktop, of the full width on phones.
  hero: {
    width: 480,
    widths: [320, 480, 720],
    sizes: '(max-width: 760px) 70vw, 340px',
    formats: ['avif'],
    fallbackFormat: 'webp',
  },
  // Detail gallery, 16:10; about half of the 1320 px max width.
  detail: {
    width: 1280,
    widths: [640, 960, 1280, 1600],
    sizes: '(max-width: 900px) 100vw, 660px',
    formats: ['avif'],
    fallbackFormat: 'webp',
  },
} satisfies Record<string, Preset>;
