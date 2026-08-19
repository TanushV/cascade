import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverVerificationCommands,
  isTrustedVerificationCommand,
  runVerificationPlan
} from "../extension/core/verification.mjs";

test("verification discovers package scripts and executes configured checks", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-verify-"));
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"", lint: "node -e \"process.exit(0)\"" } }));
  const plan = discoverVerificationCommands(cwd, ["node -e \"console.log('configured')\""]);
  assert.ok(plan.some((item) => item.kind === "test"));
  assert.ok(plan.some((item) => item.kind === "configured"));
  const report = await runVerificationPlan(plan, { cwd, timeoutMs: 10000 });
  assert.equal(report.ok, true);
});


test("only discovered or configured verifier commands count as trusted proof", () => {
  const plan = [
    { command: "npm test", kind: "test" },
    { command: "npm run lint", kind: "lint" }
  ];
  assert.equal(isTrustedVerificationCommand("npm test", plan), true);
  assert.equal(isTrustedVerificationCommand("npm   test -- parser", plan), true);
  assert.equal(isTrustedVerificationCommand("npm run lint -- --fix=false", plan), true);
  assert.equal(isTrustedVerificationCommand("echo test", plan), false);
  assert.equal(isTrustedVerificationCommand("printf build", plan), false);
  assert.equal(isTrustedVerificationCommand("npm test-not-really", plan), false);
});
