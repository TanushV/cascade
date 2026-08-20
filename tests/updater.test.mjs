import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_UPDATE_SOURCE,
  compareVersions,
  runSelfUpdate,
  updatePlan
} from "../extension/core/updater.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("self update installs current GitHub main without uninstalling", () => {
  const plan = updatePlan();
  assert.equal(plan.source, DEFAULT_UPDATE_SOURCE);
  assert.deepEqual(plan.args.slice(0, 3), ["install", "-g", DEFAULT_UPDATE_SOURCE]);
  assert.equal(plan.args.includes("uninstall"), false);
});

test("semantic versions compare predictably", () => {
  assert.equal(compareVersions("0.4.0", "0.3.9"), 1);
  assert.equal(compareVersions("0.4.0", "0.4.0"), 0);
  assert.equal(compareVersions("0.3.9", "0.4.0"), -1);
});

test("dry-run update never spawns npm or reaches the network", async () => {
  let spawned = false;
  let fetched = false;
  const result = await runSelfUpdate({
    dryRun: true,
    currentVersion: "0.4.0",
    spawn: () => { spawned = true; },
    fetchImpl: async () => { fetched = true; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(spawned, false);
  assert.equal(fetched, false);
});

test("self update refuses to downgrade from an older main branch", async () => {
  let spawned = false;
  const result = await runSelfUpdate({
    currentVersion: "0.4.0",
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: "0.2.0" }) }),
    spawn: () => { spawned = true; return { status: 0 }; }
  });
  assert.equal(result.skipped, true);
  assert.match(result.reason, /older/);
  assert.equal(spawned, false);
});

test("self update skips an already current installation", async () => {
  const result = await runSelfUpdate({
    currentVersion: "0.4.0",
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: "0.4.0" }) })
  });
  assert.equal(result.skipped, true);
  assert.match(result.reason, /already current/);
});

test("real update path reports npm failures", async () => {
  await assert.rejects(
    runSelfUpdate({
      force: true,
      currentVersion: "0.4.0",
      spawn: () => ({ status: 2 })
    }),
    /exit code 2/
  );
});


test("CLI update dry-run prints the exact in-place npm command", () => {
  const result = spawnSync(process.execPath, [join(root, "bin", "cascade.mjs"), "update", "--dry-run"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /npm(?:\.cmd)? ["\']?install["\']? ["\']?-g["\']?/);
  assert.match(result.stdout, /TanushV\/cascade/);
  assert.doesNotMatch(result.stdout, /Cascade updated/);
});
