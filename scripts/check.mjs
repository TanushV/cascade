#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walk(path) {
  const result = [];
  for (const entry of readdirSync(path)) {
    if (["node_modules", ".git", "dist"].includes(entry)) continue;
    const full = join(path, entry);
    if (statSync(full).isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

const files = walk(root);
const modules = files.filter((path) => path.endsWith(".mjs"));
for (const path of modules) {
  const check = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (check.status !== 0) failures.push(`${relative(root, path)}: ${check.stderr || check.stdout}`);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const upstream = JSON.parse(readFileSync(join(root, "UPSTREAM.json"), "utf8"));
const defaults = readFileSync(join(root, "extension", "core", "defaults.mjs"), "utf8");
const runtimeVersion = defaults.match(/PACKAGE_VERSION\s*=\s*["']([^"']+)["']/)?.[1];

for (const required of [
  "bin/cascade.mjs",
  "extension/cascade.mjs",
  "extension/index.mjs",
  "README.md",
  "INSTALL.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/PI-LICENSE.txt",
  "docs/legal.md",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/workflows/codeql.yml"
]) {
  if (!existsSync(join(root, required))) failures.push(`Missing required file: ${required}`);
}
if (packageJson.pi !== undefined) failures.push("Standalone Cascade must not expose a Pi package manifest");
if (packageJson.bin?.["cascade"] !== "./bin/cascade.mjs") failures.push("package.json binary manifest is invalid");
if (packageJson.dependencies?.["@earendil-works/pi-coding-agent"] !== "0.84.2") {
  failures.push("package.json must pin the standalone Pi runtime dependency to 0.84.2");
}
if (!existsSync(join(root, "extension", "core", "pi-runtime.mjs"))) failures.push("Missing standalone Pi runtime resolver");
if (runtimeVersion !== packageJson.version) failures.push(`Runtime version ${runtimeVersion || "missing"} differs from package ${packageJson.version}`);
if (upstream.cascadeVersion !== packageJson.version) failures.push(`UPSTREAM.json Cascade version ${upstream.cascadeVersion} differs from package ${packageJson.version}`);
if (upstream.codingAgentVersion !== packageJson.dependencies?.["@earendil-works/pi-coding-agent"]) {
  failures.push("UPSTREAM.json Pi version differs from package dependency");
}
for (const requiredPackageFile of ["INSTALL.md", "licenses", "THIRD_PARTY_NOTICES.md", "SECURITY.md"]) {
  if (!packageJson.files?.includes(requiredPackageFile)) failures.push(`package.json files omits ${requiredPackageFile}`);
}

for (const obsolete of ["scripts/apply-to-pi.mjs", "scripts/bootstrap-fork.mjs", "tests/apply-to-pi.test.mjs"]) {
  if (existsSync(join(root, obsolete))) failures.push(`Obsolete Pi-overlay artifact remains: ${obsolete}`);
}

// Prevent the removed optional integration from quietly returning in source or docs.
const removedIntegration = ["j", "space"].join("[- ]?");
const removedPattern = new RegExp(removedIntegration, "i");
for (const path of files.filter((path) => /\.(?:mjs|md|json|yml|yaml|txt)$/.test(path))) {
  if (path === fileURLToPath(import.meta.url)) continue;
  if (removedPattern.test(readFileSync(path, "utf8"))) {
    failures.push(`Removed integration reference found in ${relative(root, path)}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Static checks passed for ${modules.length} JavaScript modules.`);
