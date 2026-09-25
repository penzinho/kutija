// Imports entry renders into the site.
//
//   pnpm tsx scripts/import-images.ts <folder>
//
// Reads `<id>-<n>.jpg|jpeg|png|webp` from <folder>, writes each file to
// src/assets/entries/<id>-<n>.jpg and sets each entry's `images` in
// src/data/entries.json to its files, ordered by <n>. These are only the source
// masters: astro:assets builds the AVIF/WebP variants and srcset from them at
// build time, so a JPEG that needs no resize or rotation is copied as-is
// (re-encoding it would only lose quality); anything else becomes a JPEG capped
// at MAX_WIDTH. Entries without a file in <folder> keep their current `images`.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'src/assets/entries');
const DATA = path.join(ROOT, 'src/data/entries.json');

// The largest size any layout shows (detail gallery at 2x) stays well under this.
const MAX_WIDTH = 2000;
const JPEG_QUALITY = 86;

const NAME = /^(\d+)-(\d+)\.(jpe?g|png|webp)$/i;

type Data = { entries: { id: number; images: string[] }[] };

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error('usage: pnpm tsx scripts/import-images.ts <folder>');
    process.exit(1);
  }

  const data = JSON.parse(await readFile(DATA, 'utf8')) as Data;
  const ids = new Set(data.entries.map((e) => e.id));

  const found = new Map<number, { n: number; file: string }[]>();
  for (const file of (await readdir(folder)).sort()) {
    const m = NAME.exec(file);
    if (!m) {
      if (!file.startsWith('.')) console.warn(`skip ${file}: name is not <id>-<n>.<ext>`);
      continue;
    }
    const id = Number(m[1]);
    const n = Number(m[2]);
    if (!ids.has(id)) {
      console.warn(`skip ${file}: no entry with id ${id}`);
      continue;
    }
    const list = found.get(id) ?? [];
    if (list.some((x) => x.n === n)) throw new Error(`duplicate image ${id}-${n} in ${folder}`);
    list.push({ n, file });
    found.set(id, list);
  }

  await mkdir(OUT_DIR, { recursive: true });

  let inBytes = 0;
  let outBytes = 0;
  for (const [id, list] of found) {
    list.sort((a, b) => a.n - b.n);
    for (const { n, file } of list) {
      const src = path.join(folder, file);
      const input = await readFile(src);
      const { format, width = 0, orientation = 1 } = await sharp(input).metadata();
      const keep = format === 'jpeg' && width <= MAX_WIDTH && orientation === 1;
      const output = keep
        ? input
        : await sharp(input)
            .rotate() // apply EXIF orientation before metadata is stripped
            .resize({ width: MAX_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
            .toBuffer();
      await writeFile(path.join(OUT_DIR, `${id}-${n}.jpg`), output);
      inBytes += input.length;
      outBytes += output.length;
    }
    data.entries.find((e) => e.id === id)!.images = list.map(({ n }) => `${id}-${n}.jpg`);
  }

  await writeFile(DATA, JSON.stringify(data, null, 2) + '\n');

  const count = [...found.values()].reduce((s, l) => s + l.length, 0);
  const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
  console.log(`imported ${count} images for ${found.size} entries (${mb(inBytes)} MB → ${mb(outBytes)} MB)`);
  const missing = data.entries.filter((e) => e.images.length === 0).map((e) => e.id);
  if (missing.length) console.warn(`entries without images: ${missing.join(', ')}`);
}

await main();
