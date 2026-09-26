/**
 * Builds every logo derivative from the two source drawings.
 *   pnpm tsx scripts/build-logo.ts <colour.png> <mono.png>
 *
 * colour (transparent background) → src/assets/logo/logo.png (header),
 *   public/favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192/512.png
 * mono (black on white) → src/assets/logo/mark.png: an alpha mask where the
 *   black ink is opaque, so CSS can paint it in any token colour.
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const [colourSrc, monoSrc] = process.argv.slice(2);
if (!colourSrc || !monoSrc) {
  console.error('Usage: pnpm tsx scripts/build-logo.ts <colour.png> <mono.png>');
  process.exit(1);
}

const ASSETS = 'src/assets/logo';
const PUBLIC = 'public';

// Tight square crop around the disc.
const colour = await sharp(colourSrc).trim().toBuffer();
const square = (size: number, pad = 0) =>
  sharp(colour)
    .resize(size - pad * 2, size - pad * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();

await writeFile(`${ASSETS}/logo.png`, await square(512));
await writeFile(`${PUBLIC}/favicon-32.png`, await square(32));
await writeFile(`${PUBLIC}/icon-192.png`, await square(192));
await writeFile(`${PUBLIC}/icon-512.png`, await square(512));

// iOS ignores transparency (it fills black), so the touch icon sits on white.
await writeFile(
  `${PUBLIC}/apple-touch-icon.png`,
  await sharp(await square(180, 12)).flatten({ background: '#ffffff' }).png().toBuffer(),
);

// ICO with embedded PNGs (supported everywhere since Vista).
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map((s) => square(s)));
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(icoSizes[i]! % 256, e);
  header.writeUInt8(icoSizes[i]! % 256, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
await writeFile(`${PUBLIC}/favicon.ico`, Buffer.concat([header, ...pngs]));

// Mono mark: darkness → alpha. The white page around the disc becomes transparent.
const monoTrimmed = await sharp(monoSrc).trim({ threshold: 40 }).toBuffer();
const alpha = await sharp(monoTrimmed)
  .resize(256, 256, { fit: 'contain', background: '#ffffff' })
  .greyscale()
  .negate()
  .linear(1.15, -10) // push the scan's grey noise to clean black/white
  .toColourspace('b-w')
  .raw()
  .toBuffer();
await sharp({ create: { width: 256, height: 256, channels: 3, background: '#000000' } })
  .joinChannel(alpha, { raw: { width: 256, height: 256, channels: 1 } })
  .png({ compressionLevel: 9 })
  .toFile(`${ASSETS}/mark.png`);

console.log('Logo derivatives written.');
