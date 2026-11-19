import sharp from "sharp";
import { copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = resolve(import.meta.dir, "../assets/img/icons/tomoricon.png");
const SOURCE_SVG = resolve(import.meta.dir, "../assets/img/icons/tomoricon.svg");
const SIZES = [16, 32, 48, 256];

const layers: Buffer[] = await Promise.all(
  SIZES.map((size) =>
    sharp(SOURCE)
      .resize(size, size, { fit: "cover", kernel: "lanczos3" })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer(),
  ),
);

// ICO readers require a 6-byte header, one 16-byte directory entry per layer,
// then the raw PNG layer data at the offsets recorded below.
const count = SIZES.length;
const headerSize = 6;
const directorySize = 16 * count;
let offset = headerSize + directorySize;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: ICO
header.writeUInt16LE(count, 4); // image count

const directory = Buffer.alloc(directorySize);
for (let i = 0; i < count; i++) {
  const size = SIZES[i];
  const entry = i * 16;
  directory.writeUInt8(size === 256 ? 0 : size, entry); // width  (0 = 256 in ICO spec)
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1); // height (0 = 256 in ICO spec)
  directory.writeUInt8(0, entry + 2); // color count (0 = no palette)
  directory.writeUInt8(0, entry + 3); // reserved
  directory.writeUInt16LE(1, entry + 4); // color planes
  directory.writeUInt16LE(32, entry + 6); // bits per pixel
  directory.writeUInt32LE(layers[i].length, entry + 8); // image data size
  directory.writeUInt32LE(offset, entry + 12); // offset from file start
  offset += layers[i].length;
}

const ico = Buffer.concat([header, directory, ...layers]);

const png256 = await sharp(SOURCE)
  .resize(256, 256, { fit: "cover", kernel: "lanczos3" })
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer();

const outputs: [string, Buffer][] = [
  ["assets/img/icons/tomoricon.ico", ico],
  ["apps/docs/public/favicon.ico", ico],
  ["apps/docs/public/tomoricon.png", png256],
];

const root = resolve(import.meta.dir, "..");
for (const [rel, buf] of outputs) {
  const dest = resolve(root, rel);
  writeFileSync(dest, buf);
  console.log(`wrote ${rel} — ${(buf.length / 1024).toFixed(1)} KB`);
}

const svgDest = resolve(root, "apps/docs/public/tomoricon.svg");
copyFileSync(SOURCE_SVG, svgDest);
console.log("wrote apps/docs/public/tomoricon.svg");
