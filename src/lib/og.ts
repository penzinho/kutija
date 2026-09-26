/**
 * Build-time Open Graph images (1200×630 PNG) with satori → sharp. Used only by the
 * static endpoints under src/pages/og/. Colors are read from src/styles/tokens.css, so
 * the images follow the design tokens like the rest of the site.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import type { Entry } from '../data/entries';

export const OG_W = 1200;
export const OG_H = 630;

const root = process.cwd();
const require = createRequire(import.meta.url);

// ---- Tokens ------------------------------------------------------------------------

const tokens = new Map<string, string>();
for (const [, name, value] of readFileSync(join(root, 'src/styles/tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  // The first definition wins: later ones only override inside media queries.
  if (!tokens.has(name!)) tokens.set(name!, value!.trim());
}

/** A token's value with var() references resolved. Throws on an unknown token. */
export function token(name: string): string {
  const v = tokens.get(name);
  if (v === undefined) throw new Error(`og: unknown token ${name}`);
  return v.replace(/var\((--[\w-]+)\)/g, (_, ref: string) => token(ref));
}

// ---- Fonts -------------------------------------------------------------------------

// satori reads TTF/OTF/WOFF (no WOFF2, no variable fonts): the static @fontsource files.
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
// satori only falls back across differently named fonts, so latin-ext gets its own name;
// FONT lists both (Ž, č, ć, đ, š live in latin-ext).
const subsets = (pkg: string, base: string, name: string, weight: 400 | 500 | 700) =>
  (['latin', 'latin-ext'] as const).map((s) => ({
    name: s === 'latin' ? name : `${name} Ext`,
    weight,
    style: 'normal' as const,
    data: font(pkg, `${base}-${s}-${weight}-normal.woff`),
  }));

const fonts = [
  ...subsets('@fontsource/anton', 'anton', 'Anton', 400),
  ...subsets('@fontsource/schibsted-grotesk', 'schibsted-grotesk', 'Schibsted Grotesk', 500),
  ...subsets('@fontsource/schibsted-grotesk', 'schibsted-grotesk', 'Schibsted Grotesk', 700),
  ...subsets('@fontsource/jetbrains-mono', 'jetbrains-mono', 'JetBrains Mono', 400),
];

export const FONT = {
  display: 'Anton, Anton Ext',
  body: 'Schibsted Grotesk, Schibsted Grotesk Ext',
  mono: 'JetBrains Mono, JetBrains Mono Ext',
};

// ---- Elements ----------------------------------------------------------------------

type Style = Record<string, string | number>;
export type Node = { type: string; props: Record<string, unknown> } | string | null | false;

/** Minimal element factory (satori takes React-like objects; no JSX needed). */
export function h(type: string, props: { style?: Style; [k: string]: unknown }, ...children: Node[]): Node {
  const kids = children.filter((c) => c !== null && c !== false);
  // satori treats any non-string children (even []) as needing display: flex.
  return { type, props: { ...props, children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids } };
}

/** "→" drawn as SVG: none of the bundled font subsets has the arrow glyph. */
export function arrow(size: number, color: string): Node {
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' },
    h('path', { d: 'M3 12h17M13 5l7 7-7 7', stroke: color, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  );
}

/** The entry's cover as a JPEG data URI, cropped to w×h; null when it has no image. */
export async function coverDataUri(e: Entry, w: number, h: number): Promise<string | null> {
  const name = e.images[0];
  if (!name) return null;
  const buf = await sharp(join(root, 'src/assets/entries', name))
    .resize(w, h, { fit: 'cover' })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/**
 * Renders a 1200×630 tree to a JPEG response. Renders are photos, so JPEG keeps each
 * image around 100 KB (PNG was ~1 MB); every OG consumer accepts it.
 */
export async function renderJpeg(tree: Node): Promise<Response> {
  const svg = await satori(tree as Parameters<typeof satori>[0], { width: OG_W, height: OG_H, fonts });
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpg), { headers: { 'content-type': 'image/jpeg' } });
}

/** Host shown on the images ("nasdom.top"); null without a configured site. */
export function siteHost(site: URL | undefined): string | null {
  return site ? site.host.replace(/^www\./, '') : null;
}
