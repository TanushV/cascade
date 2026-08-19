import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { AdaptiveRouter } from "../extension/core/router.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("repeated verifier failures escalate trajectory", () => {
  const config = deepClone(DEFAULT_CONFIG);
  const router = new AdaptiveRouter(config);
  router.onTurnStart(1);
  for (let index = 0; index < 2; index += 1) {
    router.onToolCall("bash", { command: "npm test" });
    router.onToolResult({ toolName: "bash", input: { command: "npm test" }, result: "Error: tests failed", isError: true });
  }
  assert.ok(router.snapshot().score >= config.routing.thresholds.consult);
  assert.ok(["consult", "takeover"].includes(router.snapshot().level));
});

test("progress decays escalation score", () => {
  const config = deepClone(DEFAULT_CONFIG);
  const router = new AdaptiveRouter(config);
  router.onTurnStart(1);
  router.addSignal("explicitUncertainty", 6, "uncertain");
  const before = router.snapshot().score;
  router.markProgress("targeted fix applied");
  assert.ok(router.snapshot().score < before);
});

test("single mode never admits expert", () => {
  const config = deepClone(DEFAULT_CONFIG);
  config.mode = "single";
  const router = new AdaptiveRouter(config);
  const ledger = { totals: () => ({ expertCalls: 0, expertCostUsd: 0 }) };
  assert.equal(router.canConsult(ledger).allowed, false);
});

test("dual mode automatically admits an expert only after the consult threshold", () => {
  const config = deepClone(DEFAULT_CONFIG);
  const router = new AdaptiveRouter(config);
  const ledger = { totals: () => ({ expertCalls: 0, expertCostUsd: 0, estimatedTotalCostUsd: 0 }) };
  router.onTurnStart(1);
  assert.equal(router.shouldAutoConsult(ledger).consult, false);
  router.addSignal("explicitUncertainty", config.routing.thresholds.consult, "material uncertainty");
  assert.equal(router.shouldAutoConsult(ledger).consult, true);
});
