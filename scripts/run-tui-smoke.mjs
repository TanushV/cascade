#!/usr/bin/env node
import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
  console.log("Native pseudo-terminal smoke test skipped on Windows; TUI wizard behavior is covered by unit tests.");
  process.exit(0);
}

const python = process.env.PYTHON || "python3";
const result = spawnSync(python, ["scripts/tui-smoke.py"], { stdio: "inherit" });
if (result.error) {
  console.error(`Unable to run native TUI smoke test with ${python}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
