import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const outputPath = path.join(repositoryRoot, "sbom", "realm-dependencies.cdx.json");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "realm-sbom-"));
const jsOutput = path.join(temporaryRoot, "javascript.cdx.json");

const cargoPurl = (pkg) => `pkg:cargo/${encodeURIComponent(pkg.name)}@${pkg.version}`;

const manifestLicense = (manifest) => typeof manifest.license === "string"
  ? manifest.license.trim()
  : Array.isArray(manifest.licenses)
    ? manifest.licenses
      .map((license) => typeof license === "string" ? license : license?.type)
      .filter(Boolean)
      .join(" OR ")
    : "";

const javascriptLicenses = new Map();
const virtualStore = path.join(appRoot, "node_modules", ".pnpm");
for (const virtualEntry of (await readdir(virtualStore, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
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
      if (manifest?.name && manifest.version) {
        javascriptLicenses.set(`${manifest.name}@${manifest.version}`, manifestLicense(manifest));
      }
    }
  }
}

const withJavascriptLicense = (component) => {
  if (component.licenses?.length) return component;
  const packageName = component.group ? `${component.group}/${component.name}` : component.name;
  const identity = `${packageName}@${component.version}`;
  const expression = javascriptLicenses.get(identity);
  if (!expression) throw new Error(`JavaScript SBOM component has no license expression: ${identity}.`);
  return { ...component, licenses: [{ expression }] };
};

try {
  execFileSync("pnpm", [
    "sbom",
    "--sbom-format", "cyclonedx",
    "--sbom-spec-version", "1.6",
    "--prod",
    "--out", jsOutput,
  ], { cwd: appRoot, stdio: "inherit" });
  const javascript = JSON.parse(await readFile(jsOutput, "utf8"));
  const cargo = JSON.parse(execFileSync("cargo", [
    "metadata",
    "--locked",
    "--offline",
    "--manifest-path", "src-tauri/Cargo.toml",
    "--format-version", "1",
    "--filter-platform", "aarch64-apple-darwin",
  ], { cwd: appRoot, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }));

  const nodes = new Map(cargo.resolve.nodes.map((node) => [node.id, node]));
  const selected = new Set();
  const pending = [cargo.resolve.root];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || selected.has(id)) continue;
    selected.add(id);
    const node = nodes.get(id);
    for (const dependency of node?.deps ?? []) {
      const productionEdge = dependency.dep_kinds.some((kind) => kind.kind !== "dev");
      if (productionEdge) pending.push(dependency.pkg);
    }
  }

  const packages = new Map(cargo.packages.map((pkg) => [pkg.id, pkg]));
  const rustRefs = new Map(
    [...selected].map((id) => {
      const pkg = packages.get(id);
      if (!pkg) throw new Error(`Cargo metadata omitted selected package ${id}.`);
      return [id, cargoPurl(pkg)];
    }),
  );
  const rustComponents = [...selected].map((id) => {
    const pkg = packages.get(id);
    const purl = rustRefs.get(id);
    const component = {
      type: id === cargo.resolve.root ? "application" : "library",
      name: pkg.name,
      version: pkg.version,
      purl,
      "bom-ref": purl,
    };
    if (pkg.license) component.licenses = [{ expression: pkg.license }];
    if (pkg.description) component.description = pkg.description;
    return component;
  });
  const rustDependencies = [...selected].map((id) => {
    const node = nodes.get(id);
    const dependsOn = (node?.deps ?? [])
      .filter((dependency) => selected.has(dependency.pkg)
        && dependency.dep_kinds.some((kind) => kind.kind !== "dev"))
      .map((dependency) => rustRefs.get(dependency.pkg))
      .filter(Boolean)
      .sort();
    return { ref: rustRefs.get(id), dependsOn: [...new Set(dependsOn)] };
  });

  const applicationRef = "pkg:generic/realm@0.1.0";
  const jsRoot = withJavascriptLicense(javascript.metadata.component);
  const javascriptComponents = (javascript.components ?? []).map(withJavascriptLicense);
  const components = [jsRoot, ...javascriptComponents, ...rustComponents]
    .sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  const dependencies = [
    { ref: applicationRef, dependsOn: [jsRoot["bom-ref"], rustRefs.get(cargo.resolve.root)].sort() },
    ...(javascript.dependencies ?? []),
    ...rustDependencies,
  ].sort((left, right) => left.ref.localeCompare(right.ref));
  const document = {
    "$schema": "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      lifecycles: [{ phase: "build" }],
      tools: { components: [
        { type: "application", name: "pnpm", version: "11.20.0" },
        { type: "application", name: "cargo", version: "1.97.1" },
      ] },
      component: {
        type: "application",
        name: "Realm",
        version: "0.1.0",
        purl: applicationRef,
        "bom-ref": applicationRef,
        licenses: [{ license: { id: "AGPL-3.0-or-later" } }],
        properties: [{ name: "realm:target", value: "aarch64-apple-darwin" }],
      },
    },
    components,
    dependencies,
  };
  const next = `${JSON.stringify(document, null, 2)}\n`;

  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    if (current !== next) {
      console.error("SBOM is missing or stale. Run pnpm sbom:generate.");
      process.exitCode = 1;
    } else {
      console.log(`SBOM is current (${components.length} locked components).`);
    }
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, next, "utf8");
    console.log(`Generated ${path.relative(repositoryRoot, outputPath)} (${components.length} locked components).`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
