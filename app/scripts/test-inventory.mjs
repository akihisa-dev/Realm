import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname); const files = [];
async function walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.name === "node_modules" || e.name === "coverage" || e.name === "dist") continue; if (e.isDirectory()) await walk(p); else if (/\.(?:test|spec)\.(?:ts|tsx|mjs)$/u.test(e.name)) files.push(p); } }
await walk(root);
const rows = await Promise.all(files.map(async (p) => { const source = await readFile(p, "utf8"); return { path: path.relative(root, p), lines: source.split(/\r?\n/u).length, tests: (source.match(/\b(?:it|test)\s*\(/gu) ?? []).length, focused: /\.(?:only|skip)\s*\(/u.test(source) }; }));
console.log(["Test inventory", ...rows.sort((a, b) => a.path.localeCompare(b.path)).map((r) => `${r.tests}\t${r.lines}\t${r.focused ? "attention" : "ok"}\t${r.path}`)].join("\n"));
if (rows.some((r) => r.focused)) { console.error("Focused or skipped test directive found."); process.exit(1); }
