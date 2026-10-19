// Builds lightweight textures for the falling garments.
// Full-size cutouts in /public stay untouched (used in the project view);
// trimmed 640px copies go to /public/rain.
//
//   node scripts/make-rain-images.mjs

import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const src = path.join(root, "public");
const out = path.join(src, "rain");

await mkdir(out, { recursive: true });
const files = (await readdir(src)).filter((f) => /\.(webp|png)$/i.test(f));

for (const file of files) {
  const name = file.replace(/\.\w+$/, ".webp");
  const info = await sharp(path.join(src, file))
    .trim({ threshold: 1 }) // drop transparent padding so size = visible garment
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(path.join(out, name));
  console.log(`${file} -> rain/${name} ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}kB`);
}
