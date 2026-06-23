/**
 * Generates a multi-size ICO file and an optimized 256x256 PNG from assets/img/original.png.
 *
 * ICO layout: 16x16, 32x32, 48x48, 256x256 — each stored as a compressed embedded PNG
 * inside the ICO container (supported by all modern browsers and Google's faviconV2 service).
 *
 * Output:
 *   assets/img/tomoricon.ico        — replaces the bloated single-size ICO
 *   apps/docs/public/favicon.ico    — copy served by the docs site
 *   apps/docs/public/tomoricon.png  — optimized 256x256 PNG for docs
 */

import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = resolve(import.meta.dir, "../assets/img/tomoricon.png");
const SIZES = [16, 32, 48, 256];

// 1. Resize source to each target size as a compressed PNG buffer.
const layers: Buffer[] = await Promise.all(
  SIZES.map((size) =>
    sharp(SOURCE)
      .resize(size, size, { fit: "cover", kernel: "lanczos3" })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer(),
  ),
);

// 2. Build the ICO container.
//    ICO header  (6 bytes): reserved(2) + type=1(2) + count(2)
//    Per-image directory entry (16 bytes each): w(1)+h(1)+colors(1)+reserved(1)+planes(2)+bitcount(2)+size(4)+offset(4)
//    Image data: raw PNG bytes for each layer
const count = SIZES.length;
const headerSize = 6;
const directorySize = 16 * count;
let offset = headerSize + directorySize;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);     // reserved
header.writeUInt16LE(1, 2);     // type: ICO
header.writeUInt16LE(count, 4); // image count

const directory = Buffer.alloc(directorySize);
for (let i = 0; i < count; i++) {
  const size = SIZES[i];
  const entry = i * 16;
  directory.writeUInt8(size === 256 ? 0 : size, entry);      // width  (0 = 256 in ICO spec)
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1);  // height (0 = 256 in ICO spec)
  directory.writeUInt8(0, entry + 2);                         // color count (0 = no palette)
  directory.writeUInt8(0, entry + 3);                         // reserved
  directory.writeUInt16LE(1, entry + 4);                      // color planes
  directory.writeUInt16LE(32, entry + 6);                     // bits per pixel
  directory.writeUInt32LE(layers[i].length, entry + 8);       // image data size
  directory.writeUInt32LE(offset, entry + 12);                // offset from file start
  offset += layers[i].length;
}

const ico = Buffer.concat([header, directory, ...layers]);

// 3. Generate optimized 256x256 PNG.
const png256 = await sharp(SOURCE)
  .resize(256, 256, { fit: "cover", kernel: "lanczos3" })
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer();

// 4. Write outputs.
const outputs: [string, Buffer][] = [
  ["assets/img/tomoricon.ico", ico],
  ["apps/docs/public/favicon.ico", ico],
  ["apps/docs/public/tomoricon.png", png256],
];

const root = resolve(import.meta.dir, "..");
for (const [rel, buf] of outputs) {
  const dest = resolve(root, rel);
  writeFileSync(dest, buf);
  console.log(`wrote ${rel} — ${(buf.length / 1024).toFixed(1)} KB`);
}
