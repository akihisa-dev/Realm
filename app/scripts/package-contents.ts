import path from "node:path";

const allowed = new Set([
  "",
  "/.vite",
  "/.vite/build",
  "/.vite/renderer",
  "/.vite/renderer/main_window",
  "/package.json",
  "/.vite/build/main.js",
  "/.vite/build/preload.js",
]);

export function normalizePackagerPath(filePath: string): string {
  if (filePath === "" || filePath === "/") return "";
  return filePath.startsWith("/") ? filePath : `/${filePath}`;
}

export function ignoreRealmPackagePath(filePath: string): boolean {
  const normalized = normalizePackagerPath(filePath);
  if (allowed.has(normalized)) return false;
  if (normalized.startsWith("/.vite/renderer/main_window/")) return normalized.endsWith(".map");
  return true;
}

export function realmPackageExtraResources(appDirectory: string): string[] {
  const root = path.dirname(path.resolve(appDirectory));
  return [
    path.join(root, "LICENSE"),
    path.join(root, "THIRD_PARTY_NOTICES.md"),
    path.join(root, "sbom"),
    path.join(appDirectory, "native/build/realm_has_moved.dylib"),
    path.join(appDirectory, "native/build/realm_atomic_publish"),
  ];
}
