// Generates the PWA icons (PNG) with no image dependencies: draws a simple
// fridge glyph into a pixel buffer and writes it out with zlib.
//   node scripts/make-icons.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GREEN = [63, 125, 78];
const SOFT = [220, 235, 202];
const WHITE = [255, 255, 255];
const DARK = [47, 98, 60];

/** Anti-aliased rounded-rect coverage (0..1) at pixel centre (px, py). */
function roundedRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dist = Math.hypot(px - cx, py - cy);
  return Math.min(Math.max(r - dist + 0.5, 0), 1);
}

/**
 * @param {number} size
 * @param {boolean} maskable  full-bleed background, glyph kept inside the central safe zone
 */
function drawIcon(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const glyphScale = maskable ? 0.72 : 0.84;
  const g = (v) => (256 + (v - 256) * glyphScale) * s; // scale glyph about the centre

  const body = { x: g(146), y: g(70), w: 220 * glyphScale * s, h: 372 * glyphScale * s, r: 34 * glyphScale * s };
  const split = g(206);
  const bgRadius = maskable ? 0 : 112 * s;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let color = GREEN;
      let alpha = bgRadius ? roundedRect(x + 0.5, y + 0.5, 0, 0, size, size, bgRadius) : 1;

      const inBody = roundedRect(x + 0.5, y + 0.5, body.x, body.y, body.w, body.h, body.r);
      if (inBody > 0) color = mix(color, WHITE, inBody);

      // divider between freezer and fridge doors
      if (inBody > 0 && Math.abs(y + 0.5 - split) < 4 * glyphScale * s) color = mix(color, SOFT, 1);

      // door handles
      for (const hy of [g(140), g(240)]) {
        const handle = roundedRect(x + 0.5, y + 0.5, g(318), hy - 22 * glyphScale * s, 12 * glyphScale * s, 44 * glyphScale * s, 6 * glyphScale * s);
        if (handle > 0 && inBody > 0) color = mix(color, DARK, handle);
      }

      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));

fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true], // iOS rounds the corners itself, so it wants a full-bleed square
];
for (const [name, size, maskable] of targets) {
  fs.writeFileSync(path.join(outDir, name), encodePng(size, drawIcon(size, maskable)));
  console.log(`wrote public/icons/${name}`);
}
