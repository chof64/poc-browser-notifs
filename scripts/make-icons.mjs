// Generates placeholder PWA icons (192 + 512 + maskable 512) with pure Node (no deps).
// Indigo rounded square + white bell-ish glyph drawn per-pixel. Replace with real art later.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

mkdirSync("public/icons", { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function icon(size, { bg = [79, 70, 229], fg = [255, 255, 255], pad = 0.12 } = {}) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2, cy = size * 0.44, r = size * 0.20;
  const bellW = size * 0.30, bellH = size * 0.10;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      // rounded-corner background
      const rad = size * 0.22, m = size * pad;
      const ex = Math.min(x, size - 1 - x), ey = Math.min(y, size - 1 - y);
      const inRound = ex >= m || ey >= m || (ex * ex + ey * ey) <= rad * rad || true;
      let R = bg[0], G = bg[1], B = bg[2];
      // bell dome (circle) + clapper bar + dot
      const d = Math.hypot(x - cx, y - cy);
      const inBell = d < r && y < cy + r * 0.55;
      const inBar = Math.abs(x - cx) < bellW / 2 && y >= cy + r * 0.55 && y <= cy + r * 0.55 + bellH * 0.4;
      const inDot = Math.hypot(x - cx, y - (cy + r * 0.55 + bellH * 0.75)) < size * 0.035;
      if ((inBell || inBar || inDot) && inRound) { R = fg[0]; G = fg[1]; B = fg[2]; }
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

writeFileSync("public/icons/icon-192.png", icon(192));
writeFileSync("public/icons/icon-512.png", icon(512));
writeFileSync("public/icons/maskable-512.png", icon(512, { pad: 0.2 }));
console.log("Wrote public/icons/icon-192.png, icon-512.png, maskable-512.png");
