import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const iconFiles = [
  "src-tauri/icons/32x32.png",
  "src-tauri/icons/64x64.png",
  "src-tauri/icons/128x128.png",
  "src-tauri/icons/128x128@2x.png",
  "src-tauri/icons/icon.png",
];

const paeth = (left, above, upperLeft) => {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

const decodeAlpha = (buffer, label) => {
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`${label}: PNG signature is missing`);
  }

  let offset = pngSignature.length;
  let width = 0;
  let height = 0;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [bitDepth, colorType, compression, filter, interlace] = data.subarray(8, 13);
      if (bitDepth !== 8 || colorType !== 6 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(`${label}: expected a non-interlaced 8-bit RGBA PNG`);
      }
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  if (width === 0 || height === 0 || compressed.length === 0) {
    throw new Error(`${label}: PNG image data is incomplete`);
  }

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(rowLength * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const rowOffset = y * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[rowOffset - rowLength + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[rowOffset - rowLength + x - bytesPerPixel]
        : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : filter === 4
                ? paeth(left, above, upperLeft)
                : null;
      if (predictor === null) throw new Error(`${label}: unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
    inputOffset += rowLength;
  }

  let transparent = 0;
  let opaque = 0;
  for (let index = 3; index < pixels.length; index += bytesPerPixel) {
    if (pixels[index] === 0) transparent += 1;
    if (pixels[index] === 255) opaque += 1;
  }
  const alphaAt = (x, y) => pixels[(y * rowLength) + (x * bytesPerPixel) + 3];
  const corners = [
    alphaAt(0, 0),
    alphaAt(width - 1, 0),
    alphaAt(0, height - 1),
    alphaAt(width - 1, height - 1),
  ];
  if (transparent === 0 || opaque === 0 || corners.some((alpha) => alpha !== 0)) {
    throw new Error(`${label}: expected transparent corners and an opaque icon subject`);
  }
  return { width, height, transparent, opaque };
};

for (const relativePath of iconFiles) {
  const buffer = await readFile(path.join(appRoot, relativePath));
  const result = decodeAlpha(buffer, relativePath);
  console.log(`${relativePath}: ${result.width}x${result.height}, transparent=${result.transparent}, opaque=${result.opaque}`);
}

const icnsPath = "src-tauri/icons/icon.icns";
const icns = await readFile(path.join(appRoot, icnsPath));
if (icns.toString("ascii", 0, 4) !== "icns" || icns.readUInt32BE(4) !== icns.length) {
  throw new Error(`${icnsPath}: invalid ICNS container`);
}
let icnsOffset = 8;
let embeddedPngCount = 0;
while (icnsOffset < icns.length) {
  const type = icns.toString("ascii", icnsOffset, icnsOffset + 4);
  const length = icns.readUInt32BE(icnsOffset + 4);
  if (length < 8 || icnsOffset + length > icns.length) {
    throw new Error(`${icnsPath}: invalid ${type} entry length`);
  }
  const data = icns.subarray(icnsOffset + 8, icnsOffset + length);
  if (data.subarray(0, pngSignature.length).equals(pngSignature)) {
    decodeAlpha(data, `${icnsPath}:${type}`);
    embeddedPngCount += 1;
  }
  icnsOffset += length;
}
if (embeddedPngCount < 7) {
  throw new Error(`${icnsPath}: expected at least 7 transparent embedded PNG representations`);
}
console.log(`${icnsPath}: ${embeddedPngCount} transparent PNG representations verified.`);
