import test from "node:test";
import assert from "node:assert/strict";
import { activeToolNames, applyRoleToolPolicy, createToolPolicyState, sameModel, usesConfiguredModel } from "../extension/core/pi-parity.mjs";

test("unrestricted Cascade roles preserve native tools and add only Cascade controls", () => {
  let active = ["read", "bash", "edit", "write", "third_party_tool"];
  const pi = {
    getAllTools: () => [...active, "cascade_route"].map((name) => ({ name })),
    getActiveTools: () => active,
    setActiveTools: (tools) => { active = tools; }
  };
  const result = applyRoleToolPolicy({ pi, profile: { restrictTools: false }, controls: ["cascade_route"], state: createToolPolicyState() });
  assert.equal(result.restricted, false);
  assert.deepEqual(active, ["read", "bash", "edit", "write", "third_party_tool", "cascade_route"]);
});

test("explicit role restriction is reversible", () => {
  let active = ["read", "bash", "edit", "write", "third_party_tool"];
  const available = [...active, "cascade_route"];
  const pi = {
    getAllTools: () => available.map((name) => ({ name })),
    getActiveTools: () => active,
    setActiveTools: (tools) => { active = tools; }
  };
  const state = createToolPolicyState();
  applyRoleToolPolicy({ pi, profile: { restrictTools: true, tools: ["read", "bash"] }, controls: ["cascade_route"], state });
  assert.deepEqual(active, ["read", "bash", "cascade_route"]);
  applyRoleToolPolicy({ pi, profile: { restrictTools: false }, controls: ["cascade_route"], state });
  assert.deepEqual(active, ["read", "bash", "edit", "write", "third_party_tool", "cascade_route"]);
  assert.deepEqual(activeToolNames(pi), active);
});

test("model selection modes distinguish native from configured roles", () => {
  assert.equal(usesConfiguredModel({ selectionMode: "native" }), false);
  assert.equal(usesConfiguredModel({ selectionMode: "configured" }), true);
  assert.equal(sameModel({ provider: "p", id: "m" }, { provider: "p", model: "m" }), true);
});
