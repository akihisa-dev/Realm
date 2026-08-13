import { access } from "node:fs/promises";
import path from "node:path";
import { listPackage, statFile } from "@electron/asar";

export async function inspectPackagedResources(resourcesDirectory) {
  const asarPath = path.join(resourcesDirectory, "app.asar");
  await access(asarPath);
  const entries = listPackage(asarPath).map((entry) => entry.startsWith("/") ? entry : `/${entry}`);
  const required = ["/package.json", "/.vite/build/main.js", "/.vite/build/preload.js", "/.vite/renderer/main_window/index.html"];
  const missing = required.filter((entry) => !entries.includes(entry));
  const forbidden = entries.filter((entry) => entry.endsWith(".map") || entry.startsWith("/src/") || entry.startsWith("/scripts/") || entry.startsWith("/node_modules/"));
  if (missing.length || forbidden.length) throw new Error([...missing.map((entry) => `Missing package entry: ${entry}`), ...forbidden.map((entry) => `Forbidden package entry: ${entry}`)].join("\n"));
  let fileCount = 0;
  for (const entry of entries) {
    const stat = statFile(asarPath, entry.slice(1), false);
    if (!("files" in stat)) fileCount += 1;
  }
  return { appOwnedBytes: 0, appOwnedFileCount: fileCount, asarBytes: 0, asarFileCount: fileCount, legalFiles: [] };
}

export function renderPackageContentReport(report) {
  return `Packaged app-owned resources\nbytes\t${report.appOwnedBytes}\nfiles\t${report.appOwnedFileCount}`;
}
