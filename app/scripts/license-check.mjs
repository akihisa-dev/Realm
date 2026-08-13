import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const virtualStore = path.join(appRoot, "node_modules", ".pnpm");
const allowedIdentifiers = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
  "LicenseRef-public-domain",
]);

const packages = new Map();
const virtualEntries = (await readdir(virtualStore, { withFileTypes: true }).catch(() => []));
for (const virtualEntry of virtualEntries.filter((entry) => entry.isDirectory())) {
  const modulesRoot = path.join(virtualStore, virtualEntry.name, "node_modules");
  const entries = await readdir(modulesRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const candidates = entry.name.startsWith("@") && entry.isDirectory()
      ? (await readdir(path.join(modulesRoot, entry.name), { withFileTypes: true }).catch(() => []))
        .filter((child) => child.isDirectory() || child.isSymbolicLink())
        .map((child) => path.join(modulesRoot, entry.name, child.name, "package.json"))
      : [path.join(modulesRoot, entry.name, "package.json")];
    for (const candidate of candidates) {
      const manifest = await readFile(candidate, "utf8").then(JSON.parse).catch(() => null);
      if (manifest?.name && manifest.version) packages.set(`${manifest.name}@${manifest.version}`, manifest);
    }
  }
}
const hoistedRoot = path.join(appRoot, "node_modules");
for (const entry of (await readdir(hoistedRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== ".pnpm")) {
  const candidates = entry.name.startsWith("@")
    ? (await readdir(path.join(hoistedRoot, entry.name), { withFileTypes: true }).catch(() => []))
      .filter((child) => child.isDirectory() || child.isSymbolicLink())
      .map((child) => path.join(hoistedRoot, entry.name, child.name, "package.json"))
    : [path.join(hoistedRoot, entry.name, "package.json")];
  for (const candidate of candidates) {
    const manifest = await readFile(candidate, "utf8").then(JSON.parse).catch(() => null);
    if (manifest?.name && manifest.version) packages.set(`${manifest.name}@${manifest.version}`, manifest);
  }
}
async function collectHoistedManifests(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name === ".pnpm") continue;
    const child = path.join(directory, entry.name);
    const manifest = await readFile(path.join(child, "package.json"), "utf8").then(JSON.parse).catch(() => null);
    if (manifest?.name && manifest.version) packages.set(`${manifest.name}@${manifest.version}`, manifest);
    await collectHoistedManifests(child);
  }
}
await collectHoistedManifests(hoistedRoot);

const failures = [];
const sbom = JSON.parse(await readFile(path.join(repositoryRoot, "sbom", "realm-dependencies.cdx.json"), "utf8"));
const checkedRefs = new Set((sbom.components ?? [])
  .filter((component) => component.scope !== "excluded"
    || component.name === "electron"
    || component.group === "@electron"
    || component.group === "@electron-forge")
  .map((component) => `${component.group ? `${component.group}/` : ""}${component.name}@${component.version}`));
for (const [identity, manifest] of [...packages].sort(([left], [right]) => left.localeCompare(right))) {
  if (!checkedRefs.has(identity)) continue;
  let expression = typeof manifest.license === "string"
    ? manifest.license.trim()
    : Array.isArray(manifest.licenses)
      ? manifest.licenses.map((license) => typeof license === "string" ? license : license?.type).filter(Boolean).join(" OR ")
      : "";
  if (!expression) {
    const [name] = identity.split("@");
    const platformExpression = name.startsWith("lightningcss-")
      ? "MPL-2.0"
      : name.startsWith("@esbuild/") || name.startsWith("@rollup/rollup-") || name.startsWith("@rolldown/")
        ? "MIT"
        : "";
    if (!platformExpression) {
      failures.push(`${identity}: missing license expression`);
    } else {
      expression = platformExpression;
    }
  }
  const identifiers = expression
    .replace(/[()]/g, " ")
    .split(/\s+(?:AND|OR)\s+/i)
    .map((identifier) => identifier.trim())
    .filter(Boolean);
  if (identifiers.some((identifier) => !allowedIdentifiers.has(identifier))) {
    failures.push(`${identity}: ${expression}`);
  }
}

if (failures.length > 0) {
  console.error("Unapproved JavaScript package licenses:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`License policy passed (${packages.size} JavaScript packages).`);
