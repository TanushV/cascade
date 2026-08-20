import test from "node:test";
import assert from "node:assert/strict";
import { formatCascadeModeStatus, parseCascadeRuntimeStatus } from "../extension/cascade.mjs";

function ctx(provider = "openrouter", id = "cheap-worker") {
  return { model: { provider, id } };
}

test("single mode footer names the active worker model", () => {
  const status = formatCascadeModeStatus("worker · single · route worker · $0.000", ctx());
  assert.equal(status, "Single · Worker: openrouter/cheap-worker");
});

test("dual mode footer makes worker ownership and expert availability explicit", () => {
  const status = formatCascadeModeStatus("worker · dual · route worker · expert 0 · $0.000", ctx());
  assert.equal(status, "Dual · Active Worker: openrouter/cheap-worker · Expert: on-demand");
});

test("dual mode footer surfaces escalation state without raw routing telemetry", () => {
  assert.equal(
    formatCascadeModeStatus("worker · dual · route recommend:4.2 · expert 0 · $0.000", ctx()),
    "Dual · Active Worker: openrouter/cheap-worker · Expert: recommended"
  );
  assert.equal(
    formatCascadeModeStatus("worker · dual · route consult:7.5 · expert 0 · $0.000", ctx()),
    "Dual · Active Worker: openrouter/cheap-worker · Expert: consult ready"
  );
});

test("expert-active footer makes temporary ownership obvious", () => {
  const status = formatCascadeModeStatus(
    "expert · dual · route consult:8.1 · expert 1 · $0.010",
    ctx("openrouter", "strong-expert")
  );
  assert.equal(status, "Dual · Active Expert: openrouter/strong-expert · Worker paused");
});

test("attention status remains prominent", () => {
  assert.deepEqual(
    parseCascadeRuntimeStatus("Cascade · attention: session cost budget exhausted"),
    { attention: "session cost budget exhausted" }
  );
  assert.equal(
    formatCascadeModeStatus("Cascade · attention: session cost budget exhausted", ctx()),
    "Attention: session cost budget exhausted"
  );
});
