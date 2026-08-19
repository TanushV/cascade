#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([".git", "node_modules", "dist", "coverage"]);

async function collect(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, output);
    else output.push(path);
  }
  return output;
}

async function transformTextFiles(replacements) {
  for (const path of await collect(root)) {
    const buffer = await readFile(path);
    if (buffer.includes(0)) continue;
    const original = buffer.toString("utf8");
    let updated = original;
    for (const [from, to] of replacements) updated = updated.split(from).join(to);
    if (updated !== original) await writeFile(path, updated, "utf8");
  }
}

await rm(join(root, ".bootstrap"), { recursive: true, force: true });
await rm(join(root, ".github", "workflows", "bootstrap.yml"), { force: true });
await rm(join(root, ".github", "workflows", "windows-debug.yml"), { force: true });

const oldCli = join(root, "bin", "pi-cascade.mjs");
const newCli = join(root, "bin", "cascade.mjs");
if (existsSync(oldCli)) await rename(oldCli, newCli);

await transformTextFiles([
  ["PI_CASCADE", "CASCADE"],
  ["pi-cascade", "cascade"],
  ["Pi Cascade", "Cascade"],
  [".pi/cascade.json", ".cascade/config.json"],
  ["~/.pi/agent/cascade.json", "~/.config/cascade/config.json"],
  [".pi/agent/cascade", ".local/state/cascade"],
  [".pi/cascade.local.json", ".cascade/local.json"],
  ["cascade 0.1.3", "cascade 0.2.0"],
  ["Cascade 0.1.3 Test Report", "Cascade 0.2.0 Test Report"],
]);

const packagePath = join(root, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
packageJson.name = "cascade";
packageJson.version = "0.2.0";
packageJson.description = "Independent configurable one- or two-model, evidence-centered coding agent powered by the Pi runtime";
packageJson.bin = { cascade: "./bin/cascade.mjs" };
packageJson.keywords = ["coding-agent", "multi-model", "routing", "openrouter", "muse-spark", "pi-runtime"];
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

const lockPath = join(root, "package-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
lock.name = "cascade";
lock.version = "0.2.0";
if (lock.packages?.[""]) {
  lock.packages[""].name = "cascade";
  lock.packages[""].version = "0.2.0";
  lock.packages[""].bin = { cascade: "bin/cascade.mjs" };
}
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

const defaultsPath = join(root, "extension", "core", "defaults.mjs");
let defaults = await readFile(defaultsPath, "utf8");
defaults = defaults.replace(/export const PACKAGE_VERSION = "[^"]+";/, 'export const PACKAGE_VERSION = "0.2.0";');
await writeFile(defaultsPath, defaults, "utf8");

const configPath = join(root, "extension", "core", "config.mjs");
let config = await readFile(configPath, "utf8");
config = config.replace(
  /export function getGlobalConfigPath\(env = process\.env\) \{[\s\S]*?\n\}/,
  `export function getGlobalConfigPath(env = process.env) {
  if (env.CASCADE_CONFIG_GLOBAL) return resolve(env.CASCADE_CONFIG_GLOBAL);
  const configHome = env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(homedir(), ".config");
  return join(configHome, "cascade", "config.json");
}`,
);
config = config.replaceAll('join(current, ".pi")', 'join(current, ".cascade")');
config = config.replaceAll('join(findProjectRoot(cwd), ".pi", "cascade.json")', 'join(findProjectRoot(cwd), ".cascade", "config.json")');
await writeFile(configPath, config, "utf8");

for (const relativePath of [
  "extension/core/harness.mjs",
  "extension/core/ledger.mjs",
  "extension/core/workspace.mjs",
]) {
  const path = join(root, relativePath);
  let text = await readFile(path, "utf8");
  text = text.replaceAll(
    'join(homedir(), ".pi", "agent", "cascade")',
    'join(homedir(), ".local", "state", "cascade")',
  );
  text = text.replaceAll(
    'join(homedir(), ".pi", "agent", "cascade", "sessions"',
    'join(homedir(), ".local", "state", "cascade", "sessions"',
  );
  await writeFile(path, text, "utf8");
}

for (const relativePath of ["scripts/package-smoke.mjs", "scripts/release-local.mjs"]) {
  const path = join(root, relativePath);
  let text = await readFile(path, "utf8");
  text = text.replace(
    "function pack(cwd) {",
    `function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return run(process.execPath, [npmCli, ...args], options);
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function pack(cwd) {`,
  );
  text = text.split('run("npm", [').join("runNpm([");
  await writeFile(path, text, "utf8");
}

const materializePattern = /\n      - name: Materialize verified source when needed\n        shell: bash\n        run: \|\n          if \[\[ -f \.bootstrap\/materialize\.mjs \]\]; then\n            node \.bootstrap\/materialize\.mjs\n          fi\n/g;
for (const relativePath of [
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/release.yml",
]) {
  const path = join(root, relativePath);
  let text = await readFile(path, "utf8");
  text = text.replace(materializePattern, "\n");
  text = text.replaceAll(
    "npm install --ignore-scripts --no-audit --no-fund",
    "npm ci --ignore-scripts --no-audit --no-fund",
  );
  text = text.replace(
    '--prefix "$PREFIX" --no-audit --no-fund',
    '--prefix "$PREFIX" --ignore-scripts --no-audit --no-fund',
  );
  await writeFile(path, text, "utf8");
}

const changelogPath = join(root, "CHANGELOG.md");
let changelog = await readFile(changelogPath, "utf8");
if (!changelog.includes("## 0.2.0")) {
  changelog = changelog.replace(
    "# Changelog\n",
    `# Changelog\n\n## 0.2.0 - 2026-08-18\n\n### Changed\n\n- Renamed the project, npm package, executable, environment namespace, configuration paths, state paths, documentation, and release artifacts to **Cascade**.\n- The command and package are now named \`cascade\`.\n\n### Fixed\n\n- Made npm subprocess invocation portable on Windows by running npm through its JavaScript entry point when available.\n- Removed the completed source-bootstrap and temporary Windows-debug workflows.\n- CI now installs from the lockfile with \`npm ci\` and validates the materialized source tree directly.\n`,
  );
}
await writeFile(changelogPath, changelog, "utf8");

await writeFile(join(root, ".gitattributes"), "* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n", "utf8");

const leftovers = [];
for (const path of await collect(root, [])) {
  if (path.endsWith("rename-to-cascade.mjs")) continue;
  if (path.includes(`${join(".github", "workflows")}${join("", "rename-cascade")}`)) continue;
  const buffer = await readFile(path);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const token of ["PI_CASCADE", "pi-cascade", "Pi Cascade"]) {
    if (text.includes(token)) leftovers.push(`${relative(root, path)} contains ${token}`);
  }
}
if (leftovers.length > 0) {
  throw new Error(`Old project identifiers remain:\n${leftovers.join("\n")}`);
}

console.log("Cascade rename applied.");
