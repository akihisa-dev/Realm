import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const outputPath = path.join(repositoryRoot, "sbom", "realm-dependencies.cdx.json");
const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "realm-sbom-"));
const jsOutput = path.join(temporaryRoot, "javascript.cdx.json");
const sbomEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  key !== "INIT_CWD" && !key.toLowerCase().startsWith("npm_") && !key.startsWith("PNPM_")));
const compareAscii = (left, right) => {
  const leftText = String(left);
  const rightText = String(right);
  const length = Math.min(leftText.length, rightText.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftText.charCodeAt(index) - rightText.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return leftText.length - rightText.length;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => compareAscii(left, right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
};

// Keep only fields that are part of the lockfile-derived package identity or
// the legal/dependency evidence consumed by the repository gates.  Pnpm can
// add package metadata such as authors, descriptions, and arbitrary properties
// without changing the lockfile; those fields must not affect the committed
// SBOM.
const JAVASCRIPT_COMPONENT_FIELDS = [
  "type", "group", "name", "version", "scope", "purl", "bom-ref",
  "licenses", "properties", "externalReferences",
];
const HASH_FIELDS = ["alg", "content"];
const PROPERTY_FIELDS = ["name", "value"];

const ownString = (value) => typeof value === "string" ? value : undefined;
const pickStringFields = (value, fields) => Object.fromEntries(fields
  .map((field) => [field, ownString(value?.[field])])
  .filter(([, fieldValue]) => fieldValue !== undefined));
const stableArray = (value) => Array.isArray(value) ? value : [];
const sortByKey = (values, key) => values.sort((left, right) => compareAscii(key(left), key(right)));

const normalizeLicense = (license) => {
  if (!license || typeof license !== "object" || Array.isArray(license)) return null;
  const normalized = {};
  if (typeof license.expression === "string") normalized.expression = license.expression;
  if (license.license && typeof license.license === "object" && !Array.isArray(license.license)) {
    const nested = pickStringFields(license.license, ["id", "name", "url"]);
    if (Object.keys(nested).length > 0) normalized.license = nested;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
};
const licenseKey = (license) => [
  license.expression ?? "",
  license.license?.id ?? "",
  license.license?.name ?? "",
  license.license?.url ?? "",
].join("\u0000");
const normalizeLicenses = (licenses) => sortByKey(stableArray(licenses)
  .map(normalizeLicense)
  .filter(Boolean), licenseKey);
const hashKey = (hash) => [hash.alg ?? "", hash.content ?? ""].join("\u0000");
const normalizeHashes = (hashes) => sortByKey(stableArray(hashes)
  .map((hash) => pickStringFields(hash, HASH_FIELDS))
  .filter((hash) => Object.keys(hash).length > 0), hashKey);
const propertyKey = (property) => [property.name ?? "", property.value ?? ""].join("\u0000");
const normalizeProperties = (properties) => sortByKey(stableArray(properties)
  .map((property) => pickStringFields(property, PROPERTY_FIELDS))
  .filter((property) => Object.keys(property).length > 0), propertyKey);
const externalReferenceKey = (reference) => [
  reference.type ?? "",
  reference.url ?? "",
  ...stableArray(reference.hashes).map(hashKey),
].join("\u0000");
const normalizeExternalReferences = (references) => sortByKey(stableArray(references)
  .map((reference) => {
    if (reference?.type !== "distribution") return null;
    const normalized = pickStringFields(reference, ["type", "url"]);
    const hashes = normalizeHashes(reference?.hashes);
    if (hashes.length > 0) normalized.hashes = hashes;
    return normalized;
  })
  .filter((reference) => reference && Object.keys(reference).length > 0), externalReferenceKey);

const normalizeJavascriptComponent = (component) => {
  const normalized = Object.fromEntries(JAVASCRIPT_COMPONENT_FIELDS
    .filter((field) => Object.hasOwn(component, field))
    .map((field) => [field, component[field]]));
  if (Object.hasOwn(normalized, "licenses")) normalized.licenses = normalizeLicenses(normalized.licenses);
  if (Object.hasOwn(normalized, "properties")) normalized.properties = normalizeProperties(normalized.properties);
  if (Object.hasOwn(normalized, "externalReferences")) {
    normalized.externalReferences = normalizeExternalReferences(normalized.externalReferences);
  }
  return normalized;
};
const licenseExpressionFromComponent = (licenses) => stableArray(licenses)
  .map((license) => license?.expression
    ?? license?.license?.id
    ?? license?.license?.name)
  .find((expression) => typeof expression === "string" && expression.trim().length > 0)?.trim() ?? "";

const manifestLicense = (manifest) => typeof manifest.license === "string"
  ? manifest.license.trim()
  : Array.isArray(manifest.licenses)
    ? manifest.licenses
      .map((license) => typeof license === "string" ? license : license?.type)
      .filter(Boolean)
      .join(" OR ")
    : "";

const javascriptLicenses = new Map();
const recordJavascriptLicense = (identity, expression) => {
  const current = javascriptLicenses.get(identity) ?? "";
  if (current && expression && current !== expression) {
    throw new Error(`Conflicting JavaScript license expressions for ${identity}.`);
  }
  if (!current || expression) javascriptLicenses.set(identity, expression);
};
const virtualStore = path.join(appRoot, "node_modules", ".pnpm");
const storeEntries = (await readdir(virtualStore, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
for (const virtualEntry of storeEntries) {
  const modulesRoot = path.join(virtualStore, virtualEntry.name, "node_modules");
  const entries = (await readdir(modulesRoot, { withFileTypes: true }).catch(() => []))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const candidates = entry.name.startsWith("@") && entry.isDirectory()
      ? (await readdir(path.join(modulesRoot, entry.name), { withFileTypes: true }).catch(() => []))
        .filter((child) => child.isDirectory() || child.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((child) => path.join(modulesRoot, entry.name, child.name, "package.json"))
      : [path.join(modulesRoot, entry.name, "package.json")];
    for (const candidate of candidates) {
      const manifest = await readFile(candidate, "utf8").then(JSON.parse).catch(() => null);
      if (manifest?.name && manifest.version) {
        recordJavascriptLicense(`${manifest.name}@${manifest.version}`, manifestLicense(manifest));
      }
    }
  }
}
// pnpm's hoisted linker exposes the same manifests at node_modules/.  Read
// those too because the lockfile can be current while the virtual store is
// absent in a fresh local checkout.
const hoistedRoot = path.join(appRoot, "node_modules");
for (const entry of (await readdir(hoistedRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== ".pnpm").sort((left, right) => left.name.localeCompare(right.name))) {
  const candidates = entry.name.startsWith("@")
    ? (await readdir(path.join(hoistedRoot, entry.name), { withFileTypes: true }).catch(() => []))
      .filter((child) => child.isDirectory() || child.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((child) => path.join(hoistedRoot, entry.name, child.name, "package.json"))
    : [path.join(hoistedRoot, entry.name, "package.json")];
  for (const candidate of candidates) {
    const manifest = await readFile(candidate, "utf8").then(JSON.parse).catch(() => null);
    if (manifest?.name && manifest.version) recordJavascriptLicense(`${manifest.name}@${manifest.version}`, manifestLicense(manifest));
  }
}
// Follow only real nested dependency directories. Do not recurse through
// arbitrary package contents: test runners create cache package.json files
// under node_modules/.vite, and those are not installed dependencies.
const visitedNodeModules = new Set();
async function collectNestedNodeModules(directory) {
  const canonical = path.resolve(directory);
  if (visitedNodeModules.has(canonical)) return;
  visitedNodeModules.add(canonical);
  const entries = (await readdir(directory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scopeRoot = path.join(directory, entry.name);
      for (const child of (await readdir(scopeRoot, { withFileTypes: true }).catch(() => [])).sort((left, right) => left.name.localeCompare(right.name))) {
        if (!child.isDirectory() && !child.isSymbolicLink()) continue;
        await collectInstalledPackage(path.join(scopeRoot, child.name), child.isDirectory());
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      await collectInstalledPackage(path.join(directory, entry.name), entry.isDirectory());
    }
  }
}
async function collectInstalledPackage(packageRoot, recurse) {
  const manifest = await readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse).catch(() => null);
  if (manifest?.name && manifest.version) recordJavascriptLicense(`${manifest.name}@${manifest.version}`, manifestLicense(manifest));
  if (recurse) await collectNestedNodeModules(path.join(packageRoot, "node_modules"));
}
await collectNestedNodeModules(hoistedRoot);

const withJavascriptLicense = (component) => {
  const normalized = normalizeJavascriptComponent(component);
  const packageName = normalized.group ? `${normalized.group}/${normalized.name}` : normalized.name;
  const identity = `${packageName}@${normalized.version}`;
  // Prefer the installed manifest/license map because pnpm's upstream SBOM
  // can vary its CycloneDX license object shape between registry responses.
  // The committed representation is always a CycloneDX license expression.
  const expression = javascriptLicenses.get(identity) || licenseExpressionFromComponent(normalized.licenses);
  // pnpm's SBOM lists optional native packages for every platform, while a
  // local install only contains the current macOS arm64 variant. Their
  // upstream license is the parent package's license; keep this mapping
  // explicit so an unknown package still fails closed.
  const platformName = normalized.group ? `${normalized.group}/${normalized.name}` : normalized.name;
  const platformExpression = normalized.name.startsWith("lightningcss-")
    ? "MPL-2.0"
    : platformName.startsWith("@esbuild/") || platformName.startsWith("@rollup/rollup-") || platformName.startsWith("@rolldown/")
      ? "MIT"
      : "";
  if (!expression && !platformExpression) {
    if (normalized.scope === "excluded") return null;
    throw new Error(`JavaScript SBOM component has no license expression: ${identity}.`);
  }
  return { ...normalized, licenses: [{ expression: expression || platformExpression }] };
};

try {
  // Include production, development, and Electron Forge dependencies.  Forge and
  // Electron are devDependencies in package.json but are part of the shipped
  // application build and must remain visible in the release SBOM.
  execFileSync("pnpm", [
    "sbom",
    "--sbom-format", "cyclonedx",
    "--sbom-spec-version", "1.6",
    "--out", jsOutput,
  ], { cwd: appRoot, env: sbomEnvironment, stdio: "inherit" });
  const javascript = JSON.parse(await readFile(jsOutput, "utf8"));
  const applicationRef = `pkg:generic/realm@${packageJson.version}`;
  const jsRoot = withJavascriptLicense({
    type: "application",
    name: "Realm",
    version: packageJson.version,
    purl: applicationRef,
    "bom-ref": applicationRef,
    licenses: [{ license: { id: "AGPL-3.0-or-later" } }],
    properties: [{ name: "realm:target", value: "aarch64-apple-darwin" }],
  });
  const javascriptComponents = (javascript.components ?? []).map(withJavascriptLicense).filter(Boolean);
  const nativeExtension = {
    type: "library",
    name: "realm-has-moved-extension",
    version: packageJson.version,
    purl: `pkg:generic/realm-has-moved-extension@${packageJson.version}`,
    "bom-ref": `pkg:generic/realm-has-moved-extension@${packageJson.version}`,
    licenses: [{ expression: "LicenseRef-public-domain" }],
    description: "Bundled SQLite HAS_MOVED verification and host online-backup extension.",
  };
  const nativeAtomicHelper = {
    type: "application",
    name: "realm-atomic-publish-helper",
    version: packageJson.version,
    purl: `pkg:generic/realm-atomic-publish-helper@${packageJson.version}`,
    "bom-ref": `pkg:generic/realm-atomic-publish-helper@${packageJson.version}`,
    licenses: [{ expression: "AGPL-3.0-or-later" }],
    description: "Bundled macOS arm64 no-replace atomic publication helper.",
  };
  const components = [jsRoot, nativeExtension, nativeAtomicHelper, ...javascriptComponents]
    .sort((left, right) => compareAscii(left["bom-ref"], right["bom-ref"]));
  // Pnpm's upstream dependency edges are not a stable release input: shared
  // hoisted packages can be attributed to different parents between runs.
  // The lockfile remains the exact transitive graph source of truth; this
  // committed SBOM records a conservative, deterministic direct inventory.
  const componentRefs = components.map((component) => component["bom-ref"]);
  const dependencies = components
    .map((component) => ({
      ref: component["bom-ref"],
      dependsOn: component["bom-ref"] === applicationRef
        ? componentRefs.filter((ref) => ref !== applicationRef).sort(compareAscii)
        : [],
    }))
    .sort((left, right) => compareAscii(left.ref, right.ref));
  const document = {
    "$schema": "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      lifecycles: [{ phase: "build" }],
      tools: { components: [
        { type: "application", name: "pnpm", version: packageJson.packageManager.replace(/^pnpm@/u, "") },
      ] },
      component: jsRoot,
    },
    components,
    dependencies,
  };
  const next = `${JSON.stringify(canonicalize(document), null, 2)}\n`;

  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    if (current !== next) {
      const mismatchIndex = [...current].findIndex((character, index) => character !== next[index]);
      console.error(`SBOM is missing or stale near byte ${mismatchIndex < 0 ? Math.min(current.length, next.length) : mismatchIndex}. Run pnpm sbom:generate.`);
      process.exitCode = 1;
    } else {
      console.log(`SBOM is current (${components.length} locked JavaScript components).`);
    }
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, next, "utf8");
    console.log(`Generated ${path.relative(repositoryRoot, outputPath)} (${components.length} locked JavaScript components).`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
