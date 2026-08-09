import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const docsRoot = path.join(repositoryRoot, "docs");
const ignoredDirectories = new Set([".git", "node_modules", "target", "dist", "coverage", "artifacts", "release-assets"]);

async function collectMarkdown(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(absolute)));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

const markdownFiles = await collectMarkdown(repositoryRoot);
const failures = [];
const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

for (const markdownFile of markdownFiles) {
  const source = await readFile(markdownFile, "utf8");
  for (const match of source.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || rawTarget.startsWith("#") || /^(?:https?:|mailto:)/.test(rawTarget)) continue;
    const withoutTitle = rawTarget.replace(/\s+["'][^"']*["']$/, "");
    const filePart = withoutTitle.split("#", 1)[0];
    if (!filePart) continue;
    const target = path.resolve(path.dirname(markdownFile), decodeURIComponent(filePart));
    try {
      await access(target);
    } catch {
      failures.push(`${path.relative(repositoryRoot, markdownFile)} -> ${filePart}`);
    }
  }
}

const indexSource = await readFile(path.join(docsRoot, "INDEX.md"), "utf8");
const indexedDocs = new Set(
  [...indexSource.matchAll(markdownLinkPattern)]
    .map((match) => match[1]?.split("#", 1)[0])
    .filter((target) => target?.endsWith(".md"))
    .map((target) => path.normalize(path.resolve(docsRoot, target))),
);

for (const markdownFile of markdownFiles.filter((file) => file.startsWith(`${docsRoot}${path.sep}`))) {
  if (markdownFile === path.join(docsRoot, "INDEX.md")) continue;
  if (!indexedDocs.has(path.normalize(markdownFile))) {
    failures.push(`docs/INDEX.md does not route to ${path.relative(repositoryRoot, markdownFile)}`);
  }
}

if (failures.length > 0) {
  console.error("Documentation validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation validation passed (${markdownFiles.length} Markdown files).`);
