import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const files = [];
async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) await walk(p); else if (/\.(?:ts|tsx)$/u.test(entry.name)) files.push(p); } }
await walk(sourceRoot);
const imports = new Map();
const failures = [];
for (const file of files) {
  const rel = path.relative(sourceRoot, file).split(path.sep).join("/");
  const source = await readFile(file, "utf8");
  const isRenderer = !rel.startsWith("main/") && !rel.startsWith("preload/");
  if (isRenderer && !rel.startsWith("migration-tests/") && /from\s+["'](?:node:|electron|fs|path|child_process|net|http)/u.test(source)) failures.push(`${rel}: renderer imports native module`);
  if (isRenderer && /\b(?:fetch|WebSocket|EventSource)\s*\(/u.test(source)) failures.push(`${rel}: network client is not allowed`);
  const deps = [];
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
    const target = path.normalize(path.join(path.dirname(file), match[1]));
    const candidates = [`${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")];
    const resolved = candidates.find((candidate) => files.includes(candidate));
    if (resolved) deps.push(resolved);
  }
  imports.set(file, deps);
}
const visiting = new Set(); const visited = new Set();
function visit(file, stack = []) { if (visiting.has(file)) { failures.push(`import cycle: ${[...stack, file].map((p) => path.relative(sourceRoot, p)).join(" -> ")}`); return; } if (visited.has(file)) return; visiting.add(file); for (const dep of imports.get(file) ?? []) visit(dep, [...stack, file]); visiting.delete(file); visited.add(file); }
for (const file of files) visit(file);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Architecture validation passed (${files.length} TypeScript source files; Electron boundary and import cycles checked).`);
