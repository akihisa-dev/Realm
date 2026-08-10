import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(appRoot, "src");

async function collectSource(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await collectSource(absolute)));
    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) result.push(absolute);
  }
  return result;
}

const failures = [];
const files = await collectSource(sourceRoot);

for (const file of files) {
  const relative = path.relative(sourceRoot, file);
  const source = await readFile(file, "utf8");
  const isTauriAdapter = relative === path.join("backend", "tauriRealmBackend.ts");
  const isTauriAdapterTest = relative === path.join("backend", "tauriRealmBackend.test.ts");
  if (!isTauriAdapter && !isTauriAdapterTest && /@tauri-apps\/(?:api|plugin-dialog)/.test(source)) {
    failures.push(`${relative} crosses the Tauri boundary; use backend/tauriRealmBackend.ts.`);
  }
  const isOpenLayersAdapter = relative.startsWith(`${path.join("map", "")}`);
  if (!isOpenLayersAdapter && /from\s+["']ol(?:\/|["'])/.test(source)) {
    failures.push(`${relative} crosses the renderer boundary; use the app/src/map boundary.`);
  }
  if (/from\s+["'](?:node:|fs|path|child_process|net|http)/.test(source)) {
    failures.push(`${relative} imports a Node.js native module into the webview.`);
  }
  if (/\b(?:rusqlite|sqlite3?|SELECT\s|INSERT\s|UPDATE\s|DELETE\s+FROM)\b/i.test(source)) {
    failures.push(`${relative} contains persistence logic that belongs in Rust.`);
  }
  if (/\b(?:fetch|WebSocket|EventSource)\s*\(/.test(source)) {
    failures.push(`${relative} introduces a network client into the local-only webview.`);
  }
  if (/\bany\b/.test(source) && !relative.endsWith("vite-env.d.ts")) {
    failures.push(`${relative} contains an explicit any escape.`);
  }
}

if (failures.length > 0) {
  console.error("Architecture validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Architecture validation passed (${files.length} TypeScript source files).`);
