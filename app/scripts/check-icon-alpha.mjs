import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
for (const name of ["32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png"]) {
  const file = path.join(appRoot, "assets", "icons", name);
  const bytes = await readFile(file);
  if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error(`${name}: invalid PNG`);
}
const icns = await readFile(path.join(appRoot, "assets", "icons", "icon.icns"));
if (icns.toString("ascii", 0, 4) !== "icns" || icns.readUInt32BE(4) !== icns.length) throw new Error("icon.icns: invalid ICNS container");
console.log("Icon assets passed signature checks.");
