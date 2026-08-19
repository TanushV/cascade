import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { runProgrammaticWorkspace } from "../extension/core/workspace.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("programmatic workspace refuses implicit unsandboxed execution", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-workspace-refuse-"));
  const config = deepClone(DEFAULT_CONFIG);
  config.workspaceRuntime.enabled = true;
  config.workspaceRuntime.sandboxCommand = [];
  config.workspaceRuntime.allowUnsandboxed = false;
  await assert.rejects(
    runProgrammaticWorkspace({ code: "result = 1", cwd, config, sessionId: "s" }),
    /requires workspaceRuntime\.sandboxCommand/
  );
});

test("programmatic workspace persists bounded JSON state when explicitly allowed", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-workspace-state-"));
  const state = mkdtempSync(join(tmpdir(), "cascade-workspace-root-"));
  process.env.PI_CASCADE_STATE_DIR = state;
  const config = deepClone(DEFAULT_CONFIG);
  config.workspaceRuntime.enabled = true;
  config.workspaceRuntime.sandboxCommand = [];
  config.workspaceRuntime.allowUnsandboxed = true;
  const code = 'state["count"] = state.get("count", 0) + 1\nresult = state["count"]';
  const first = await runProgrammaticWorkspace({ code, cwd, config, sessionId: "session" });
  const second = await runProgrammaticWorkspace({ code, cwd, config, sessionId: "session" });
  const reset = await runProgrammaticWorkspace({ code, cwd, config, sessionId: "session", reset: true });
  assert.equal(first.result, 1);
  assert.equal(second.result, 2);
  assert.equal(reset.result, 1);
  assert.equal(first.sandboxed, false);
  delete process.env.PI_CASCADE_STATE_DIR;
});

test("programmatic workspace reports timeouts explicitly", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-workspace-timeout-"));
  const config = deepClone(DEFAULT_CONFIG);
  config.workspaceRuntime.enabled = true;
  config.workspaceRuntime.sandboxCommand = [];
  config.workspaceRuntime.allowUnsandboxed = true;
  config.workspaceRuntime.timeoutMs = 50;
  await assert.rejects(
    runProgrammaticWorkspace({ code: "while True:\n    pass", cwd, config, sessionId: "timeout" }),
    /timed out/
  );
});
