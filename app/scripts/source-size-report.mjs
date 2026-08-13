import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);
const rows = [];
async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.name === "node_modules" || entry.name === "coverage" || entry.name === "dist") continue; if (entry.isDirectory()) await walk(p); else if (/\.(?:ts|tsx|mjs)$/u.test(entry.name)) rows.push({ path: path.relative(root, p), lines: (await readFile(p, "utf8")).split(/\r?\n/u).length }); } }
await walk(root);
rows.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
console.log(["Source size report", ...rows.slice(0, 30).map((row) => `${row.lines}\t${row.path}`)].join("\n"));
if (rows.some((row) => row.lines > 1200)) { console.error("Source file exceeds 1200 lines."); process.exit(1); }
