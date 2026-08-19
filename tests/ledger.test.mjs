import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { EvidenceLedger, estimateUsageCost, loadLedgerFile } from "../extension/core/ledger.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("evidence ledger persists redacted bounded handoff", () => {
  const state = mkdtempSync(join(tmpdir(), "cascade-ledger-state-"));
  const cwd = mkdtempSync(join(tmpdir(), "cascade-ledger-cwd-"));
  process.env.PI_CASCADE_STATE_DIR = state;
  const config = deepClone(DEFAULT_CONFIG);
  config.mode = "single";
  config.evidence.persist = true;
  const ledger = new EvidenceLedger({ cwd, config, harnessManifest: { hash: "abc" } });
  ledger.recordUserGoal("fix api_key=supersecretvalue");
  ledger.recordToolResult("bash", { command: "npm test" }, "failed token=abcdefghijklmnop", true, { exitCode: 1 });
  const { json } = ledger.buildEvidencePacket({
    question: "what failed?",
    routeState: { level: "consult" },
    maximumCharacters: 10000,
    maximumEntries: 20,
    harnessState: {},
    includeGitState: false
  });
  assert.doesNotMatch(json, /supersecretvalue/);
  assert.doesNotMatch(json, /abcdefghijklmnop/);
  assert.match(json, /REDACTED/);
  assert.ok(loadLedgerFile(ledger.path).length >= 3);
  delete process.env.PI_CASCADE_STATE_DIR;
});

test("cost estimator uses per-million rates", () => {
  const cost = estimateUsageCost({ input: 1_000_000, output: 500_000 }, { input: 1, output: 2 });
  assert.equal(cost, 2);
});
