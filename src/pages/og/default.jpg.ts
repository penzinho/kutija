import type { APIRoute } from 'astro';
import { awarded, entries } from '../../data/entries';
import { FONT, arrow, coverDataUri, h, renderJpeg, siteHost, token } from '../../lib/og';

// Site-wide share image: the headline plus the jury's first four prizes.
const TILE_W = 250;
const TILE_H = 236;

export const GET: APIRoute = async ({ site }) => {
  const host = siteHost(site);
  const tiles = await Promise.all(awarded.slice(0, 4).map(async (e) => ({ e, img: await coverDataUri(e, TILE_W, TILE_H) })));

  const tree = h(
    'div',
    {
      style: {
        display: 'flex',
        width: '100%',
        height: '100%',
        padding: 64,
        gap: 48,
        background: token('--c-navy-950'),
        backgroundImage: token('--c-top3-glow'),
        color: token('--c-ink'),
      },
    },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 552 } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontFamily: FONT.mono,
            fontSize: 22,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: token('--c-ink-2'),
          },
        },
        h('div', { style: { width: 12, height: 12, borderRadius: 999, background: token('--c-accent') } }),
        `Narodni Maksimir · ${entries.length} radova`,
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', fontFamily: FONT.display, textTransform: 'uppercase' } },
        h('div', { style: { fontSize: 56, lineHeight: 1, color: token('--c-ink-2') } }, 'Žiri je odlučio.'),
        h('div', { style: { fontSize: 112, lineHeight: 0.9, marginTop: 16 } }, 'Sad je red'),
        h(
          'div',
          { style: { display: 'flex', gap: 24, fontSize: 112, lineHeight: 0.9 } },
          'na',
          h('span', { style: { color: token('--c-accent') } }, 'narodu.'),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT.mono, fontSize: 22, color: token('--c-accent') } },
        host ? `${host}/dvoboj` : 'Kreni glasati',
        arrow(22, token('--c-accent')),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', alignContent: 'center', gap: 18, width: TILE_W * 2 + 18 } },
      ...tiles.map(({ e, img }) =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              position: 'relative',
              width: TILE_W,
              height: TILE_H,
              borderRadius: 14,
              overflow: 'hidden',
              background: token('--c-navy-900'),
              border: `1px solid ${token('--c-top3-row-bd')}`,
            },
          },
          img && h('img', { src: img, width: TILE_W, height: TILE_H, style: { objectFit: 'cover' } }),
          h(
            'div',
            {
              style: {
                position: 'absolute',
                left: 12,
                bottom: 12,
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 999,
                background: token(`--award-${e.award}-bg`),
                color: token(`--award-${e.award}-fg`),
                border: `2px solid ${token(`--award-${e.award}-bd`)}`,
                fontFamily: FONT.body,
                fontWeight: 700,
                fontSize: 18,
              },
            },
            h('span', { style: { fontFamily: FONT.display, fontWeight: 400, fontSize: 24 } }, `${e.award}.`),
            'nagrada',
          ),
        ),
      ),
    ),
  );

  return renderJpeg(tree);
};
