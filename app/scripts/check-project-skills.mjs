import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const skillsRoot = path.join(repositoryRoot, ".agents", "skills");

const expectedSkills = [
  "realm-audit-code-health",
  "realm-audit-skills",
  "realm-change-history",
  "realm-change-local-verification",
  "realm-change-map",
  "realm-change-storage",
  "realm-change-ui",
  "realm-commit",
  "realm-debug-packaging",
  "realm-guard-task",
  "realm-maintain-docs",
  "realm-manage-version",
  "realm-publish-github",
  "realm-refactor-codebase",
  "realm-release",
  "realm-retire-feature",
  "realm-test-code",
  "realm-test-development-app",
  "realm-update-dependencies",
];

const failures = [];
const directories = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (JSON.stringify(directories) !== JSON.stringify(expectedSkills)) {
  failures.push(`Skill set differs from the routed set: ${directories.join(", ")}`);
}

for (const skillName of directories) {
  const skillRoot = path.join(skillsRoot, skillName);
  const topLevel = (await readdir(skillRoot, { withFileTypes: true })).map((entry) => entry.name).sort();
  if (JSON.stringify(topLevel) !== JSON.stringify(["SKILL.md", "agents"])) {
    failures.push(`${skillName} has unexpected top-level resources: ${topLevel.join(", ")}`);
  }

  const agentsRoot = path.join(skillRoot, "agents");
  const agentFiles = (await readdir(agentsRoot, { withFileTypes: true })).map((entry) => entry.name).sort();
  if (JSON.stringify(agentFiles) !== JSON.stringify(["openai.yaml"])) {
    failures.push(`${skillName}/agents must contain only openai.yaml.`);
  }

  const skillSource = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const frontmatter = skillSource.match(/^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/);
  if (!frontmatter) {
    failures.push(`${skillName}/SKILL.md must have only name and single-line description frontmatter.`);
  } else {
    const [, declaredName, description] = frontmatter;
    if (declaredName !== skillName) failures.push(`${skillName} declares name ${declaredName}.`);
    if (description.trim().length === 0 || description.length > 1024) {
      failures.push(`${skillName} has an invalid description length.`);
    }
  }

  const interfaceSource = await readFile(path.join(agentsRoot, "openai.yaml"), "utf8");
  const displayName = interfaceSource.match(/^  display_name: "([^"]+)"$/m)?.[1];
  const shortDescription = interfaceSource.match(/^  short_description: "([^"]+)"$/m)?.[1];
  const defaultPrompt = interfaceSource.match(/^  default_prompt: "([^"]+)"$/m)?.[1];
  if (!displayName) failures.push(`${skillName}/agents/openai.yaml is missing display_name.`);
  if (!shortDescription || shortDescription.length < 25 || shortDescription.length > 64) {
    failures.push(`${skillName}/agents/openai.yaml short_description must be 25-64 characters.`);
  }
  if (!defaultPrompt?.includes(`$${skillName}`)) {
    failures.push(`${skillName}/agents/openai.yaml default_prompt must reference $${skillName}.`);
  }

  const combined = `${skillSource}\n${interfaceSource}`;
  for (const forbidden of [/\brelic-/i, /\belectron\b/i, /\.github\/workflows/i, /\bci:workflows\b/i]) {
    if (forbidden.test(combined)) failures.push(`${skillName} contains stale cross-project guidance: ${forbidden}.`);
  }
  if (/\bTODO\b/.test(combined)) failures.push(`${skillName} contains an unresolved TODO.`);
}

if (failures.length > 0) {
  console.error("Project Skill validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Project Skill validation passed (${directories.length} Realm Skills).`);
