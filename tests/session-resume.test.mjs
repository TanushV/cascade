import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { EvidenceLedger } from "../extension/core/ledger.mjs";
import { AdaptiveRouter } from "../extension/core/router.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("ledger resumes Pi session totals and user goal without resetting budgets", () => {
  const state = mkdtempSync(join(tmpdir(), "cascade-resume-state-"));
  const cwd = mkdtempSync(join(tmpdir(), "cascade-resume-cwd-"));
  process.env.CASCADE_STATE_DIR = state;
  const config = deepClone(DEFAULT_CONFIG);
  config.privacy.redactSecrets = false;
  const first = new EvidenceLedger({ cwd, config, sessionId: "pi-session-123" });
  first.recordUserGoal("repair the parser");
  first.recordAssistantUsage("worker", { input: 1000, output: 100 }, 0.125);
  first.recordExpertCall({
    question: "which invariant matters?",
    mode: "consult",
    model: "openrouter/expert",
    result: "{}",
    usage: { input: 100, output: 20 },
    estimatedCostUsd: 0.5,
    routeState: {}
  });

  const resumed = new EvidenceLedger({ cwd, config, sessionId: "pi-session-123" });
  assert.equal(resumed.lastUserGoal, "repair the parser");
  assert.equal(resumed.totals().expertCalls, 1);
  assert.equal(resumed.totals().expertCostUsd, 0.5);
  assert.equal(resumed.totals().workerCostUsd, 0.125);
  assert.equal(resumed.latest("session_resume")?.kind, "session_resume");
  delete process.env.CASCADE_STATE_DIR;
});

test("router restores trajectory and enforces the total session budget", () => {
  const config = deepClone(DEFAULT_CONFIG);
  config.mode = "dual";
  config.budgets.maxSessionEstimatedCostUsd = 1;
  const router = new AdaptiveRouter(config);
  router.restore({
    turnIndex: 7,
    score: 8,
    consecutiveErrors: 2,
    lastProgressTurn: 4,
    lastConsultTurn: 5,
    signals: [{ type: "verifierFailure", weight: 3, reason: "tests failed", turn: 7 }]
  });
  assert.equal(router.snapshot().turnIndex, 7);
  assert.equal(router.snapshot().score, 8);
  const ledger = {
    totals() {
      return { expertCalls: 0, expertCostUsd: 0, estimatedTotalCostUsd: 1.01 };
    }
  };
  assert.deepEqual(router.canConsult(ledger, { ignoreCooldown: true }), {
    allowed: false,
    reason: "session cost budget exhausted"
  });
});


test("ledger restores complete cost totals even when history exceeds its memory window", () => {
  const state = mkdtempSync(join(tmpdir(), "cascade-long-resume-state-"));
  const cwd = mkdtempSync(join(tmpdir(), "cascade-long-resume-cwd-"));
  process.env.CASCADE_STATE_DIR = state;
  try {
    const config = deepClone(DEFAULT_CONFIG);
    config.privacy.redactSecrets = false;
    const first = new EvidenceLedger({ cwd, config, sessionId: "long-session" });
    first.recordAssistantUsage("worker", { input: 100 }, 0.25);
    first.recordExpertCall({
      question: "preserve this cost",
      mode: "consult",
      model: "openrouter/expert",
      result: "{}",
      usage: { input: 10, output: 5 },
      estimatedCostUsd: 0.75,
      routeState: {}
    });
    for (let index = 0; index < 520; index += 1) {
      first.record("noise", { index }, { status: "verified" });
    }

    const resumed = new EvidenceLedger({ cwd, config, sessionId: "long-session" });
    assert.equal(resumed.entries.length, 500);
    assert.equal(resumed.totals().expertCalls, 1);
    assert.equal(resumed.totals().expertCostUsd, 0.75);
    assert.equal(resumed.totals().workerCostUsd, 0.25);
  } finally {
    delete process.env.CASCADE_STATE_DIR;
  }
});
