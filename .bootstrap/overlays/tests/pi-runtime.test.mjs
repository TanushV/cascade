import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPiRuntime, normalizeExecutableLaunch, resolvePiRuntime, spawnPi } from "../extension/core/pi-runtime.mjs";

function fakeRuntime() {
  const root = mkdtempSync(join(tmpdir(), "cascade-runtime-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.2" }));
  const cli = join(dist, "cli.js");
  writeFileSync(cli, `#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log('pi 0.84.2-test');\nelse console.log(JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(cli, 0o755);
  return { root, cli };
}

test("automatic runtime resolves the packaged Pi dependency path", () => {
  const { cli } = fakeRuntime();
  const runtime = resolvePiRuntime({ piBinary: "auto" }, { env: { ...process.env, PI_CASCADE_INTERNAL_PI_CLI: cli } });
  assert.equal(runtime.source, "internal-override");
  assert.equal(runtime.version, "0.84.2");
  assert.equal(runtime.command, process.execPath);
  assert.deepEqual(runtime.argsPrefix, [cli]);
});

test("runtime health check executes the resolved CLI", () => {
  const { cli } = fakeRuntime();
  const result = checkPiRuntime({ piBinary: "auto" }, { env: { ...process.env, PI_CASCADE_INTERNAL_PI_CLI: cli } });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /0\.84\.2-test/);
});

test("explicit runtime binary remains supported", () => {
  const { cli } = fakeRuntime();
  const runtime = resolvePiRuntime({ piBinary: cli });
  assert.equal(runtime.source, "explicit-binary");
  assert.equal(runtime.command, cli);
  assert.deepEqual(runtime.argsPrefix, []);
});

test("JavaScript entrypoints are launched through Node on every platform", () => {
  const script = join(tmpdir(), "cascade-runtime-script.mjs");
  const launch = normalizeExecutableLaunch(script, ["--version"]);
  assert.equal(launch.command, process.execPath);
  assert.deepEqual(launch.args, [script, "--version"]);
});
