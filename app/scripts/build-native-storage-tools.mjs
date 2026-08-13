import { access, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = resolve(root, "native");
const vendorRoot = resolve(nativeRoot, "vendor");
const buildRoot = resolve(nativeRoot, "build");

const tools = [
  {
    source: resolve(nativeRoot, "realm_has_moved.c"),
    output: resolve(buildRoot, "realm_has_moved.dylib"),
    flags: ["-dynamiclib", "-fPIC"],
  },
  {
    source: resolve(nativeRoot, "realm_atomic_publish.c"),
    output: resolve(buildRoot, "realm_atomic_publish"),
    flags: [],
  },
];

await mkdir(buildRoot, { recursive: true });
for (const tool of tools) {
  try {
    await access(tool.source);
  } catch {
    throw new Error(`Missing native storage source: ${tool.source}`);
  }
  const args = [
    ...tool.flags,
    "-arch", "arm64",
    "-mmacosx-version-min=14.0",
    "-O2", "-Wall", "-Wextra", "-Werror",
    `-I${nativeRoot}`,
    `-I${vendorRoot}`,
    tool.source,
    "-o", tool.output,
  ];
  await new Promise((resolvePromise, reject) => {
    const child = spawn("clang", args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`clang terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`clang exited with ${code ?? "unknown"}`));
      else resolvePromise();
    });
  });
  console.log(tool.output);
}
