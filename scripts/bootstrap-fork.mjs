#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = JSON.parse(readFileSync(resolve(packageRoot, "UPSTREAM.json"), "utf8"));

function parse(argv) {
  const result = { target: "./cascade-fork", branch: "cascade" };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--branch") result.branch = argv[++index];
    else if (arg === "--remote") result.remote = argv[++index];
    else if (["-h", "--help"].includes(arg)) result.help = true;
    else positional.push(arg);
  }
  if (positional[0]) result.target = positional[0];
  return result;
}

function run(executable, args, options = {}) {
  return execFileSync(executable, args, { stdio: "inherit", ...options });
}

function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/bootstrap-fork.mjs [TARGET] [--branch NAME] [--remote URL]");
    return;
  }
  const target = resolve(options.target);
  if (existsSync(target)) throw new Error(`Target already exists: ${target}`);
  const remote = options.remote || `https://github.com/${upstream.repository}.git`;

  run("git", ["clone", "--no-checkout", remote, target]);
  run("git", ["fetch", "--depth", "1", "origin", upstream.commit], { cwd: target });
  run("git", ["checkout", "-b", options.branch, upstream.commit], { cwd: target });
  run(process.execPath, [resolve(packageRoot, "scripts", "apply-to-pi.mjs"), "--pi-source", target], { cwd: packageRoot });
  console.log(`Fork source prepared at ${target}`);
  console.log(`Branch: ${options.branch}; upstream: ${upstream.repository}@${upstream.commit}`);
}

try { main(); }
catch (error) {
  console.error(`bootstrap-fork: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
