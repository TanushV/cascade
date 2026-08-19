#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;

function parse(argv) {
  const result = { out: join(root, "dist", "release"), skipTests: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") result.out = resolve(argv[++index]);
    else if (arg === "--skip-tests") result.skipTests = true;
    else if (["-h", "--help"].includes(arg)) result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function run(executable, args, options = {}) {
  return execFileSync(executable, args, { cwd: options.cwd || root, stdio: "inherit", ...options });
}

function copySource(source, destination) {
  const excluded = new Set(["node_modules", ".git", ".pi", "dist"]);
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (excluded.has(entry) || entry.endsWith(".tgz")) continue;
    const from = join(source, entry);
    const to = join(destination, entry);
    if (statSync(from).isDirectory()) copySource(from, to);
    else cpSync(from, to);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/release-local.mjs [--out DIR] [--skip-tests]");
    return;
  }
  if (!options.skipTests) {
    run("npm", ["run", "ci"]);
  }

  rmSync(options.out, { recursive: true, force: true });
  mkdirSync(options.out, { recursive: true });

  const raw = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", options.out], {
    cwd: root,
    encoding: "utf8"
  });
  const pack = JSON.parse(raw);
  const npmTarball = join(options.out, pack[0].filename);

  const stagingParent = mkdtempSync(join(tmpdir(), "pi-cascade-release-"));
  const stageName = `pi-cascade-${version}`;
  const stage = join(stagingParent, stageName);
  try {
    copySource(root, stage);
    const tarPath = join(options.out, `pi-cascade-${version}-full-source.tar.gz`);
    const zipPath = join(options.out, `pi-cascade-${version}-full-source.zip`);
    run("tar", ["-czf", tarPath, stageName], { cwd: stagingParent });
    run("zip", ["-qr", zipPath, stageName], { cwd: stagingParent });


    const readmePath = join(options.out, `pi-cascade-${version}-README.md`);
    const testReportPath = join(options.out, `pi-cascade-${version}-TEST_REPORT.md`);
    cpSync(join(root, "README.md"), readmePath);
    cpSync(join(root, "TEST_REPORT.md"), testReportPath);

    const files = [npmTarball, tarPath, zipPath, readmePath, testReportPath];
    const checksumPath = join(options.out, `pi-cascade-${version}-SHA256SUMS.txt`);
    writeFileSync(
      checksumPath,
      `${files.map((path) => `${sha256(path)}  ${basename(path)}`).join("\n")}\n`,
      "utf8"
    );
    console.log(`Release created at ${options.out}`);
    for (const path of [...files, checksumPath]) console.log(path);
  } finally {
    rmSync(stagingParent, { recursive: true, force: true });
  }
}

try { main(); }
catch (error) {
  console.error(`release-local: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
