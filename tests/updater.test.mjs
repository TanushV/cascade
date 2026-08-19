import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildUpdateInvocation, runSelfUpdate } from "../extension/core/updater.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("self-update targets the GitHub source by default", () => {
  const invocation = buildUpdateInvocation({ npmExecPath: "/tmp/npm-cli.js" });
  assert.ok(invocation.args.includes("github:TanushV/cascade"));
  assert.deepEqual(invocation.args.slice(1, 4), ["install", "-g", "github:TanushV/cascade"]);
});

test("self-update can execute through npm's current CLI without shell quoting", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-updater-"));
  const fakeNpm = join(dir, "npm-cli.mjs");
  const output = join(dir, "args.json");
  writeFileSync(fakeNpm, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.UPDATE_CAPTURE, JSON.stringify(process.argv.slice(2)));\n`, "utf8");
  chmodSync(fakeNpm, 0o755);
  const result = runSelfUpdate({
    env: { ...process.env, npm_execpath: fakeNpm, UPDATE_CAPTURE: output }
  });
  assert.equal(result.ok, true);
  const args = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(args.slice(0, 3), ["install", "-g", "github:TanushV/cascade"]);
  assert.ok(args.includes("--ignore-scripts"));
});


test("cascade update dry-run exposes the one-command GitHub update path", () => {
  const result = spawnSync(process.execPath, [join(root, "bin", "cascade.mjs"), "update", "--dry-run"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dryRun, true);
  assert.match(parsed.display, /github:TanushV\/cascade/);
});

test("cascade pull is an alias for the one-command updater", () => {
  const result = spawnSync(process.execPath, [join(root, "bin", "cascade.mjs"), "pull", "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env }
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dryRun, true);
  assert.ok(parsed.args.includes("github:TanushV/cascade"));
});
