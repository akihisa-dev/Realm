import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile); const out = path.join(process.cwd(), `.renderer-production-${process.pid}`);
try { await rm(out, { force: true, recursive: true }); await exec("pnpm", ["exec", "vite", "build", "--config", "vite.renderer.config.ts", "--outDir", out, "--emptyOutDir", "--manifest"], { cwd: process.cwd(), env: { ...process.env, CI: "true", npm_config_confirm_modules_purge: "false" } }); const html = await readFile(path.join(out, "index.html"), "utf8"); if (!html.includes("<script")) throw new Error("renderer entry script missing"); console.log("Renderer production check passed."); } finally { await rm(out, { force: true, recursive: true }); }
