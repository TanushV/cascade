import test from "node:test";
import assert from "node:assert/strict";
import {
  activeToolNames,
  applyRoleToolPolicy,
  createToolPolicyState,
  sameModel,
  usesConfiguredModel
} from "../extension/core/pi-parity.mjs";

test("unrestricted Cascade roles leave Pi's active tool set untouched", () => {
  const calls = [];
  const pi = {
    getAllTools: () => ["read", "bash", "edit", "write", "custom"].map((name) => ({ name })),
    getActiveTools: () => ["read", "bash", "edit", "write", "custom"],
    setActiveTools: (tools) => calls.push(tools)
  };
  const state = createToolPolicyState();
  const result = applyRoleToolPolicy({ pi, profile: { restrictTools: false }, controls: ["cascade_route"], state });
  assert.equal(result.changed, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(activeToolNames(pi), ["read", "bash", "edit", "write", "custom"]);
});

test("an explicit restriction is reversible without losing native Pi tools", () => {
  const calls = [];
  let active = ["read", "bash", "edit", "write", "custom"];
  const pi = {
    getAllTools: () => ["read", "bash", "edit", "write", "custom", "cascade_route"].map((name) => ({ name })),
    getActiveTools: () => active,
    setActiveTools: (tools) => { active = tools; calls.push(tools); }
  };
  const state = createToolPolicyState();
  applyRoleToolPolicy({
    pi,
    profile: { restrictTools: true, tools: ["read", "bash"] },
    controls: ["cascade_route"],
    state
  });
  assert.deepEqual(active, ["read", "bash", "cascade_route"]);
  applyRoleToolPolicy({ pi, profile: { restrictTools: false }, controls: ["cascade_route"], state });
  assert.deepEqual(active, ["read", "bash", "edit", "write", "custom", "cascade_route"]);
  assert.equal(calls.length, 2);
});

test("native and configured model selection are distinguished", () => {
  assert.equal(usesConfiguredModel({ selectionMode: "native" }), false);
  assert.equal(usesConfiguredModel({ selectionMode: "configured" }), true);
  assert.equal(sameModel({ provider: "p", id: "m" }, { provider: "p", model: "m" }), true);
});
