/**
 * generate-images.js
 * Creates og-image.png and CanalClear_Logo.png using pure Node.js.
 * No dependencies — runs during build phase.
 */
'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── CRC32 ──────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf  = Buffer.from(type, 'ascii');
  const lenBuf   = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf   = Buffer.allocUnsafe(4);
  const crcInput = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Create a PNG with a solid background + optional horizontal gradient tint.
 * Each pixel: r, g, b.
 */
function makePNG(width, height, topColor, bottomColor) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 2;  // color type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Raw image data: filter byte + RGB per pixel per row
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.allocUnsafe(1 + width * 3);
    row[0] = 0; // no filter
    const t = y / (height - 1);
    const r = Math.round(topColor[0] + t * (bottomColor[0] - topColor[0]));
    const g = Math.round(topColor[1] + t * (bottomColor[1] - topColor[1]));
    const b = Math.round(topColor[2] + t * (bottomColor[2] - topColor[2]));
    for (let x = 0; x < width; x++) {
      row[1 + x * 3]     = r;
      row[1 + x * 3 + 1] = g;
      row[1 + x * 3 + 2] = b;
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 6 });

  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Generate og-image.png (1200×630) ──────────────────────────────────────────
// Deep navy to slightly lighter navy — CanalClear brand
const ogImage = makePNG(
  1200, 630,
  [10, 25, 47],   // top: #0a1929 (deep navy)
  [15, 40, 80]    // bottom: #0f2850 (slightly lighter navy)
);
fs.writeFileSync(path.join(__dirname, '../public/og-image.png'), ogImage);
console.log('[generate-images] ✓ og-image.png created (1200×630)');

// ── Generate CanalClear_Logo.png (400×120) ─────────────────────────────────────
const logoImage = makePNG(
  400, 120,
  [10, 25, 47],   // same navy
  [10, 25, 47]
);
fs.writeFileSync(path.join(__dirname, '../public/CanalClear_Logo.png'), logoImage);
console.log('[generate-images] ✓ CanalClear_Logo.png created (400×120)');

console.log('[generate-images] Done. All images generated.');
