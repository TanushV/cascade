import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadEffectiveConfig } from "../extension/core/config.mjs";
import cascadeExtension from "../extension/index.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function oldGeneratedConfig() {
  return {
    schemaVersion: 1,
    mode: "dual",
    worker: {
      provider: "meta-model-api",
      model: "muse-spark-1.2-contributor",
      thinking: "medium",
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write"]
    },
    expert: {
      provider: "openrouter",
      model: "openrouter/auto",
      thinking: "high",
      tools: ["read", "grep", "find", "ls", "bash"]
    },
    privacy: { classification: "unknown", allowContributor: false }
  };
}

test("legacy generated Contributor config migrates to native Pi startup", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-legacy-migration-"));
  mkdirSync(join(cwd, ".cascade"));
  writeFileSync(join(cwd, ".cascade", "config.json"), JSON.stringify(oldGeneratedConfig()));
  const result = loadEffectiveConfig({ cwd, projectTrusted: true, env: { ...process.env } });
  assert.equal(result.config.worker.selectionMode, "native");
  assert.equal(result.config.worker.thinkingMode, "native");
  assert.equal(result.config.worker.restrictTools, false);
  assert.equal(result.validation.errors.length, 0);
});

test("cascade starts Pi instead of rejecting the legacy Contributor config", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-legacy-startup-"));
  mkdirSync(join(cwd, ".cascade"));
  writeFileSync(join(cwd, ".cascade", "config.json"), JSON.stringify(oldGeneratedConfig()));
  const fakePi = join(cwd, "fake-pi.mjs");
  const capture = join(cwd, "capture.json");
  writeFileSync(fakePi, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CAPTURE, JSON.stringify({ args: process.argv.slice(2), warning: process.env.CASCADE_STARTUP_WARNING || '' }));\n`, "utf8");
  chmodSync(fakePi, 0o755);
  const env = { ...process.env, CAPTURE: capture, CASCADE_STATE_DIR: join(cwd, ".state") };
  for (const name of Object.keys(env)) {
    if (name.endsWith("_API_KEY") || name === "MODEL_API_KEY" || name === "OPENROUTER_API_KEY") delete env[name];
  }
  const result = spawnSync(process.execPath, [
    join(root, "bin", "cascade.mjs"),
    "--approve",
    "--pi-bin", fakePi
  ], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const recorded = JSON.parse(readFileSync(capture, "utf8"));
  assert.ok(recorded.args.includes("--extension"));
  assert.equal(recorded.args.includes("--provider"), false);
  assert.equal(recorded.args.includes("--model"), false);
  assert.equal(recorded.warning, "");
});

function createRuntimeMock(ctx) {
  const events = new Map();
  const commands = new Map();
  const tools = new Map();
  const notifications = [];
  let active = ["read", "grep", "bash", "edit", "write", "custom-tool"];
  const pi = {
    registerFlag() {},
    getFlag() { return undefined; },
    registerProvider() {},
    registerTool(tool) { tools.set(tool.name, tool); if (!active.includes(tool.name)) active.push(tool.name); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { const list = events.get(name) || []; list.push(handler); events.set(name, list); },
    getAllTools() { return active.map((name) => ({ name })); },
    getActiveTools() { return [...active]; },
    setActiveTools(next) { active = [...next]; },
    getCommands() { return [...commands.keys()].map((name) => ({ name })); },
    async setModel(model) { ctx.model = model; return true; },
    getThinkingLevel() { return "medium"; },
    setThinkingLevel() {},
    appendEntry() {},
    sendMessage() {},
    sendUserMessage() {}
  };
  ctx.ui = {
    setStatus() {},
    notify(message, type) { notifications.push({ message, type }); },
    theme: { fg(_name, value) { return value; } }
  };
  return { pi, events, commands, tools, notifications, active: () => [...active] };
}

async function emit(mock, name, event, ctx) {
  let result;
  for (const handler of mock.events.get(name) || []) result = await handler(event, ctx);
  return result;
}

test("blocked configured worker falls back to native Pi without removing tools or slash commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-runtime-fallback-"));
  const configPath = join(cwd, "cascade.json");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    mode: "single",
    worker: {
      selectionMode: "configured",
      thinkingMode: "configured",
      restrictTools: false,
      provider: "meta-model-api",
      model: "muse-spark-1.2-contributor",
      thinking: "medium",
      tools: ["read", "bash", "edit", "write"]
    },
    privacy: { classification: "unknown", allowContributor: false }
  }));
  const previousConfig = process.env.CASCADE_CONFIG;
  const previousState = process.env.CASCADE_STATE_DIR;
  process.env.CASCADE_CONFIG = configPath;
  process.env.CASCADE_STATE_DIR = join(cwd, ".state");
  try {
    const ctx = {
      cwd,
      model: { provider: "openrouter", id: "native-ready" },
      thinkingLevel: "medium",
      modelRegistry: {
        find(provider, id) { return { provider, id }; },
        getAll() { return [ctx.model]; },
        getAvailable() { return [ctx.model]; },
        getProviderDisplayName(provider) { return provider; }
      },
      sessionManager: { getSessionId() { return "fallback"; } },
      isProjectTrusted() { return true; },
      hasPendingMessages() { return false; }
    };
    const mock = createRuntimeMock(ctx);
    cascadeExtension(mock.pi);
    await emit(mock, "session_start", { type: "session_start", reason: "startup" }, ctx);
    for (const tool of ["read", "bash", "edit", "write", "custom-tool"]) assert.ok(mock.active().includes(tool));
    assert.ok(mock.notifications.some((entry) => /continuing with native Pi/i.test(entry.message)));
    const command = await emit(mock, "input", { text: "/login openrouter", source: "interactive" }, ctx);
    assert.deepEqual(command, { action: "continue" });
  } finally {
    if (previousConfig === undefined) delete process.env.CASCADE_CONFIG; else process.env.CASCADE_CONFIG = previousConfig;
    if (previousState === undefined) delete process.env.CASCADE_STATE_DIR; else process.env.CASCADE_STATE_DIR = previousState;
  }
});
