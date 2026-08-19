import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("wrapper injects extension and fully configurable worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-wrapper-"));
  const fake = join(dir, "fake-pi.mjs");
  const argsFile = join(dir, "args.json");
  writeFileSync(fake, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FAKE_ARGS, JSON.stringify({ args: process.argv.slice(2), env: { workerTools: process.env.PI_CASCADE_WORKER_TOOLS, expertTools: process.env.PI_CASCADE_EXPERT_TOOLS, expertTimeout: process.env.PI_CASCADE_EXPERT_TIMEOUT_MS, sessionCost: process.env.PI_CASCADE_MAX_SESSION_COST_USD } }));\n`, "utf8");
  chmodSync(fake, 0o755);
  const result = spawnSync(process.execPath, [
    join(root, "bin", "pi-cascade.mjs"),
    "--single",
    "--worker", "openrouter/vendor/worker-model",
    "--worker-tools", "read,grep,bash",
    "--expert-tools", "read,grep",
    "--expert-timeout-ms", "45000",
    "--max-session-cost-usd", "2.5",
    "--pi-bin", fake,
    "--",
    "--mode", "json",
    "hello"
  ], {
    cwd: dir,
    env: { ...process.env, FAKE_ARGS: argsFile, PI_CASCADE_STATE_DIR: join(dir, "state") },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const captured = JSON.parse(readFileSync(argsFile, "utf8"));
  const args = captured.args;
  assert.ok(args.includes("--extension"));
  assert.ok(args.map((value) => String(value).replaceAll("\\", "/")).some((value) => value.endsWith("extension/index.mjs")));
  assert.deepEqual(args.slice(args.indexOf("--provider"), args.indexOf("--provider") + 4), ["--provider", "openrouter", "--model", "vendor/worker-model"]);
  assert.ok(args.includes("hello"));
  assert.equal(captured.env.workerTools, "read,grep,bash");
  assert.equal(captured.env.expertTools, "read,grep");
  assert.equal(captured.env.expertTimeout, "45000");
  assert.equal(captured.env.sessionCost, "2.5");
});


test("wrapper launches the packaged runtime without a global pi command", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-wrapper-bundled-"));
  const packageRoot = join(dir, "fake-runtime");
  const dist = join(packageRoot, "dist");
  const fake = join(dist, "cli.js");
  const argsFile = join(dir, "args.json");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.2" }));
  writeFileSync(fake, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nif (process.argv.includes('--version')) { console.log('pi 0.84.2-test'); process.exit(0); }\nwriteFileSync(process.env.FAKE_ARGS, JSON.stringify(process.argv.slice(2)));\n`, "utf8");
  chmodSync(fake, 0o755);
  const result = spawnSync(process.execPath, [
    join(root, "bin", "pi-cascade.mjs"),
    "--single",
    "--worker", "openrouter/vendor/worker-model",
    "--",
    "--mode", "json",
    "hello"
  ], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: "/definitely/no/pi/here",
      PI_CASCADE_INTERNAL_PI_CLI: fake,
      FAKE_ARGS: argsFile,
      PI_CASCADE_STATE_DIR: join(dir, "state")
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.ok(args.includes("--extension"));
  assert.ok(args.includes("vendor/worker-model"));
});
