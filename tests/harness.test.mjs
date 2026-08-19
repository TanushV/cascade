import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { HarnessStore } from "../extension/core/harness.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("harness candidates require evaluation, promote, and roll back", () => {
  const state = mkdtempSync(join(tmpdir(), "cascade-harness-state-"));
  const cwd = mkdtempSync(join(tmpdir(), "cascade-harness-cwd-"));
  process.env.CASCADE_STATE_DIR = state;
  const config = deepClone(DEFAULT_CONFIG);
  const harness = new HarnessStore({ cwd, config, sessionId: "test-session" });
  const candidate = harness.propose({
    summary: "Remember the repository test command",
    rationale: "It was rediscovered repeatedly",
    expectedOutcome: "Fewer exploratory turns",
    predictedRegressions: [],
    edits: [{ action: "create", kind: "memory", title: "Test command", content: "Use npm test", path: "repository" }]
  }, { scope: "repository", evidenceIds: ["e1"] });
  assert.throws(() => harness.promote(candidate.id), /replay evaluation is required/);
  const evaluated = harness.evaluate(candidate.id, {
    taskCount: 5,
    qualityDelta: 0.02,
    costDelta: -0.1,
    latencyDelta: -0.05,
    expertCallRateDelta: 0,
    deterministicChecksPassed: true
  });
  assert.equal(evaluated.admission.allowed, true);
  harness.promote(candidate.id);
  assert.match(harness.promptOverlay(), /Use npm test/);
  harness.rollback(candidate.id);
  assert.doesNotMatch(harness.promptOverlay(), /Use npm test/);
  delete process.env.CASCADE_STATE_DIR;
});

test("canary activation is process-local and never persists as promoted state", () => {
  const state = mkdtempSync(join(tmpdir(), "cascade-harness-canary-state-"));
  const cwd = mkdtempSync(join(tmpdir(), "cascade-harness-canary-cwd-"));
  process.env.CASCADE_STATE_DIR = state;
  const config = deepClone(DEFAULT_CONFIG);
  config.harnessLearning.mode = "canary";
  const first = new HarnessStore({ cwd, config, sessionId: "session-a" });
  const candidate = first.propose({
    summary: "Temporary prompt",
    rationale: "test",
    expectedOutcome: "test",
    predictedRegressions: [],
    edits: [{ action: "create", kind: "prompt", title: "Temporary", content: "CANARY_ONLY", path: "session" }]
  }, { scope: "session", evidenceIds: [] });
  first.activateCanary(candidate.id);
  assert.match(first.promptOverlay(), /CANARY_ONLY/);

  const restarted = new HarnessStore({ cwd, config, sessionId: "session-a" });
  assert.doesNotMatch(restarted.promptOverlay(), /CANARY_ONLY/);
  assert.equal(restarted.requireCandidate(candidate.id).status, "proposed");

  process.env.CASCADE_CANARY_IDS = candidate.id;
  const explicitReplay = new HarnessStore({ cwd, config, sessionId: "session-b" });
  assert.match(explicitReplay.promptOverlay(), /CANARY_ONLY/);
  delete process.env.CASCADE_CANARY_IDS;
  delete process.env.CASCADE_STATE_DIR;
});
