import type { APIRoute, GetStaticPaths } from 'astro';
import { entries, statusLabel, type Entry } from '../../../data/entries';
import { FONT, OG_H, arrow, coverDataUri, h, renderJpeg, siteHost, token } from '../../../lib/og';

export const getStaticPaths = (() => entries.map((entry) => ({ params: { id: String(entry.id) }, props: { entry } }))) satisfies GetStaticPaths;

const IMG_W = 620;

export const GET: APIRoute<{ entry: Entry }> = async ({ props: { entry: e }, site }) => {
  const num = String(e.id).padStart(2, '0');
  const img = await coverDataUri(e, IMG_W, OG_H);
  const bg = token('--c-navy-950');
  const host = siteHost(site);

  const badge = e.award
    ? h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            alignSelf: 'flex-start',
            padding: '10px 22px',
            borderRadius: 999,
            background: token(`--award-${e.award}-bg`),
            color: token(`--award-${e.award}-fg`),
            border: `2px solid ${token(`--award-${e.award}-bd`)}`,
            fontFamily: FONT.body,
            fontWeight: 700,
            fontSize: 26,
          },
        },
        h('span', { style: { fontFamily: FONT.display, fontWeight: 400, fontSize: 34 } }, `${e.award}.`),
        'nagrada žirija',
      )
    : h('div', { style: { fontFamily: FONT.body, fontWeight: 500, fontSize: 28, color: token('--c-ink-2') } }, statusLabel(e));

  const tree = h(
    'div',
    { style: { display: 'flex', width: '100%', height: '100%', background: bg, color: token('--c-ink') } },
    h(
      'div',
      { style: { display: 'flex', position: 'relative', width: IMG_W, height: OG_H, background: token('--c-navy-900') } },
      img && h('img', { src: img, width: IMG_W, height: OG_H, style: { objectFit: 'cover' } }),
      h('div', {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: IMG_W,
          height: OG_H,
          backgroundImage: `linear-gradient(90deg, transparent 62%, ${bg})`,
        },
      }),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 1,
          padding: '56px 60px 56px 36px',
        },
      },
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
        'Naš Dom',
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 22 } },
        h(
          'div',
          { style: { fontFamily: FONT.display, fontSize: 176, lineHeight: 0.86, textTransform: 'uppercase' } },
          `Rad ${num}`,
        ),
        h('div', { style: { fontFamily: FONT.mono, fontSize: 26, color: token('--c-ink-3') } }, e.code),
        badge,
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 14, fontFamily: FONT.body, fontWeight: 700, fontSize: 30, color: token('--c-accent') } },
          e.status === 'excluded' ? 'Pogledaj rad' : 'Usporedi u dvoboju',
          arrow(30, token('--c-accent')),
        ),
        host && h('div', { style: { fontFamily: FONT.mono, fontSize: 20, color: token('--c-ink-3') } }, `${host}/rad/${e.id}`),
      ),
    ),
  );

  return renderJpeg(tree);
};
