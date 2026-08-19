import test from "node:test";
import assert from "node:assert/strict";
import {
  activeToolNames,
  applyRoleToolPolicy,
  comparePiSurface,
  createToolPolicyState,
  sameModel,
  snapshotPiSurface,
  usesConfiguredModel
} from "../extension/core/pi-parity.mjs";

test("unrestricted roles leave Pi's active tool set untouched", () => {
  const calls = [];
  const active = ["read", "bash", "edit", "write", "custom", "cascade_route"];
  const pi = {
    getAllTools: () => active.map((name) => ({ name })),
    getActiveTools: () => [...active],
    setActiveTools: (tools) => calls.push(tools)
  };
  const result = applyRoleToolPolicy({
    pi,
    profile: { restrictTools: false },
    controls: ["cascade_route"],
    state: createToolPolicyState()
  });
  assert.equal(result.changed, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(activeToolNames(pi), active);
});

test("explicit tool restriction is reversible without losing native Pi tools", () => {
  let active = ["read", "bash", "edit", "write", "custom", "cascade_route"];
  const pi = {
    getAllTools: () => active.map((name) => ({ name })),
    getActiveTools: () => [...active],
    setActiveTools: (tools) => { active = [...tools]; }
  };
  const state = createToolPolicyState();
  applyRoleToolPolicy({ pi, profile: { restrictTools: true, tools: ["read", "bash"] }, controls: ["cascade_route"], state });
  assert.deepEqual(active, ["read", "bash", "cascade_route"]);
  // The available catalog must still contain the native tools while restricted.
  pi.getAllTools = () => ["read", "bash", "edit", "write", "custom", "cascade_route"].map((name) => ({ name }));
  applyRoleToolPolicy({ pi, profile: { restrictTools: false }, controls: ["cascade_route"], state });
  assert.deepEqual(active, ["read", "bash", "edit", "write", "custom", "cascade_route"]);
});

test("model-selection and parity helpers distinguish native/configured state", () => {
  assert.equal(usesConfiguredModel({ selectionMode: "native" }), false);
  assert.equal(usesConfiguredModel({ selectionMode: "configured" }), true);
  assert.equal(sameModel({ provider: "p", id: "m" }, { provider: "p", model: "m" }), true);
  const pi = {
    getActiveTools: () => ["read", "write"],
    getCommands: () => [{ name: "model" }, { name: "login" }]
  };
  const before = snapshotPiSurface(pi);
  const after = { tools: ["read", "write", "cascade_route"], commands: ["model", "login", "cascade"] };
  assert.deepEqual(comparePiSurface(before, after), { missingTools: [], missingCommands: [] });
});
