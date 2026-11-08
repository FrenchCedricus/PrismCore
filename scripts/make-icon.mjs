// Génère build/icon.png (256 × 256) : le même anneau dégradé que l'icône de la zone de notification.
// electron-builder en dérive l'icône .ico de l'exécutable et de l'installateur.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
const c = (SIZE - 1) / 2, outer = SIZE / 2 - 2, inner = SIZE * 0.24;
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filtre PNG : aucun
  for (let x = 0; x < SIZE; x++) {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
    const a = Math.min(1, Math.max(0, outer - d + 0.5)) * Math.min(1, Math.max(0, d - inner + 0.5));
    const t = (Math.atan2(dy, dx) / Math.PI + 1) / 2;
    const i = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[i] = Math.round(139 + (34 - 139) * t);
    raw[i + 1] = Math.round(92 + (211 - 92) * t);
    raw[i + 2] = Math.round(246 + (238 - 246) * t);
    raw[i + 3] = Math.round(a * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let k = n; for (let j = 0; j < 8; j++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; return k >>> 0; });
const crc = (buf) => { let r = 0xffffffff; for (const b of buf) r = crcTable[(r ^ b) & 0xff] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`Icône générée : ${out}`);
