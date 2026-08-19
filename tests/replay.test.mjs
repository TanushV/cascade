import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { HarnessStore } from "../extension/core/harness.mjs";
import { runHarnessReplay } from "../extension/core/replay.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("harness replay compares baseline and canary with direct absolute task paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "cascade-replay-"));
  const state = join(root, "state");
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  process.env.PI_CASCADE_STATE_DIR = state;
  const fake = join(root, "fake-cascade.mjs");
  writeFileSync(fake, `#!/usr/bin/env node\nconst canary = Boolean(process.env.PI_CASCADE_CANARY_IDS);\nconsole.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:canary?'candidate':'baseline'}],usage:{input:100,output:20,cost:{total:canary?0.009:0.01}}}}));\n`, "utf8");
  chmodSync(fake, 0o755);
  const manifest = join(root, "manifest.json");
  writeFileSync(manifest, JSON.stringify({
    mode: "single",
    tasks: [{ id: "one", cwd: "project", prompt: "test", verification: ["node -e \"process.exit(0)\""] }]
  }));
  const config = deepClone(DEFAULT_CONFIG);
  config.mode = "single";
  config.harnessLearning.promotion.minimumTaskCount = 1;
  config.harnessLearning.promotion.maximumComplexityIncrease = 2;
  config.harnessLearning.promotion.maximumLatencyIncrease = 10;
  const harness = new HarnessStore({ cwd: project, config, sessionId: "test" });
  const candidate = harness.propose({
    summary: "Prefer targeted checks",
    rationale: "Repeated broad verification",
    expectedOutcome: "Lower cost",
    predictedRegressions: [],
    edits: [{ action: "create", kind: "memory", title: "Targeted checks", content: "Run targeted checks first", path: "repository" }]
  }, { scope: "repository", evidenceIds: ["e1"] });
  const report = await runHarnessReplay({
    candidateId: candidate.id,
    manifestPath: manifest,
    config,
    cwd: project,
    executable: fake,
    packageRoot: root,
    isolate: false,
    baseEnv: { ...process.env }
  });
  assert.equal(report.baseline.results[0].cwd, project);
  assert.equal(report.candidate.results[0].cwd, project);
  assert.equal(report.metrics.deterministicChecksPassed, true);
  assert.equal(report.admission.allowed, true);
  assert.ok(report.metrics.costDelta < 0);
  delete process.env.PI_CASCADE_STATE_DIR;
});
