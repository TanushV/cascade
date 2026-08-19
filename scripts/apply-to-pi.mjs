#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "../extension/core/util.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM = Object.freeze(JSON.parse(readFileSync(join(packageRoot, "UPSTREAM.json"), "utf8")));

function parse(argv) {
  const options = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pi-source") options.piSource = resolve(argv[++index]);
    else if (arg === "--force") options.force = true;
    else if (["-h", "--help"].includes(arg)) options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parse(process.argv.slice(2));
  if (options.help || !options.piSource) {
    console.log("Usage: node scripts/apply-to-pi.mjs --pi-source /path/to/pi [--force]");
    return;
  }
  const rootPackagePath = join(options.piSource, "package.json");
  const codingAgentPath = join(options.piSource, "packages", "coding-agent", "package.json");
  if (!existsSync(rootPackagePath) || !existsSync(codingAgentPath)) {
    throw new Error(`${options.piSource} is not a compatible Pi source checkout`);
  }
  const codingAgent = JSON.parse(readFileSync(codingAgentPath, "utf8"));
  if (codingAgent.name !== "@earendil-works/pi-coding-agent") throw new Error("Unexpected Pi coding-agent package identity");
  const target = join(options.piSource, "packages", "cascade");
  if (existsSync(target)) {
    if (!options.force) throw new Error(`Target already exists: ${target}. Use --force to replace it.`);
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  for (const entry of [
    "bin", "extension", "docs", "examples", "licenses", "policies", "scripts", "tests",
    "README.md", "INSTALL.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM.json", "CHANGELOG.md",
    "CONTRIBUTING.md", "SECURITY.md", "TEST_REPORT.md", "package.json"
  ]) {
    cpSync(join(packageRoot, entry), join(target, entry), { recursive: true });
  }
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  rootPackage.scripts ||= {};
  rootPackage.scripts.cascade = "node packages/cascade/bin/cascade.mjs";
  rootPackage.scripts["cascade:test"] = "npm test --workspace=cascade";
  rootPackage.scripts["cascade:check"] = "npm run check --workspace=cascade";
  rootPackage.scripts["cascade:smoke"] = "npm run smoke --workspace=cascade";
  atomicWriteJson(rootPackagePath, rootPackage, 0o644);
  atomicWriteJson(join(options.piSource, "CASCADE_UPSTREAM.json"), {
    ...UPSTREAM,
    expectedCodingAgentVersion: UPSTREAM.codingAgentVersion,
    detectedCodingAgentVersion: codingAgent.version,
    appliedAt: new Date().toISOString(),
    integration: "workspace package and supported Pi extension APIs"
  }, 0o644);
  console.log(`Applied Cascade to ${options.piSource}`);
  console.log("Run: npm install --ignore-scripts && npm run cascade -- --approve \"your task\"");
}

try { main(); }
catch (error) {
  console.error(`apply-to-pi: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
