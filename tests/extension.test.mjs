import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cascadeExtension from "../extension/index.mjs";

function createMockPi(ctx) {
  const events = new Map();
  const tools = new Map();
  const commands = new Map();
  const statuses = new Map();
  const notifications = [];
  const entries = [];
  const messages = [];
  const activeTools = [];
  const providers = [];
  const pi = {
    registerFlag() {},
    getFlag() { return undefined; },
    registerProvider(name, config) { providers.push({ name: typeof name === "string" ? name : name.id, config }); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); },
    async setModel(model) { ctx.model = model; return true; },
    setThinkingLevel(level) { pi.thinking = level; },
    getThinkingLevel() { return pi.thinking || "off"; },
    getAllTools() { return ["read", "grep", "find", "ls", "bash", "edit", "write", ...tools.keys()].map((name) => ({ name })); },
    getActiveTools() { return [...activeTools]; },
    setActiveTools(values) { activeTools.splice(0, activeTools.length, ...values); },
    appendEntry(type, data) { entries.push({ type, data }); },
    sendMessage(message, options) { messages.push({ message, options }); },
    sendUserMessage(message, options) { messages.push({ user: message, options }); }
  };
  ctx.ui = {
    setStatus(key, value) { statuses.set(key, value); },
    notify(message, type) { notifications.push({ message, type }); },
    theme: { fg(_name, value) { return value; } }
  };
  return { pi, events, tools, commands, statuses, notifications, entries, messages, activeTools, providers };
}

async function emit(mock, name, event, ctx) {
  let result;
  for (const handler of mock.events.get(name) || []) result = await handler(event, ctx);
  return result;
}

test("extension initializes single-model worker and records route evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-extension-"));
  const configPath = join(dir, "cascade.json");
  const statePath = join(dir, "state");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    mode: "single",
    worker: { provider: "openrouter", model: "worker-model", thinking: "low", tools: ["read", "bash", "edit"] },
    privacy: { classification: "internal", allowContributor: false }
  }));
  process.env.CASCADE_CONFIG = configPath;
  process.env.CASCADE_STATE_DIR = statePath;
  const ctx = {
    cwd: dir,
    model: undefined,
    signal: undefined,
    modelRegistry: { find(provider, id) { return { provider, id, maxTokens: 10000 }; } },
    isProjectTrusted() { return true; },
    hasPendingMessages() { return false; }
  };
  const mock = createMockPi(ctx);
  cascadeExtension(mock.pi);
  await emit(mock, "session_start", { type: "session_start", reason: "startup" }, ctx);
  assert.equal(ctx.model.provider, "openrouter");
  assert.equal(ctx.model.id, "worker-model");
  assert.equal(mock.pi.thinking, "low");
  assert.ok(mock.activeTools.includes("cascade_route"));
  assert.equal(mock.activeTools.includes("cascade_expert"), false);

  const input = await emit(mock, "input", { text: "fix the bug", source: "interactive" }, ctx);
  assert.deepEqual(input, { action: "continue" });
  const before = await emit(mock, "before_agent_start", { systemPrompt: "BASE" }, ctx);
  assert.match(before.systemPrompt, /Cascade runtime/);
  await emit(mock, "turn_start", { turnIndex: 1 }, ctx);
  await emit(mock, "tool_call", { toolName: "bash", input: { command: "npm test" }, toolCallId: "1" }, ctx);
  await emit(mock, "tool_result", { toolName: "bash", input: { command: "npm test" }, content: [{ type: "text", text: "tests failed" }], isError: true, details: { exitCode: 1 }, toolCallId: "1" }, ctx);
  const route = await mock.tools.get("cascade_route").execute("x", { refreshRepository: false }, undefined, undefined, ctx);
  assert.match(route.content[0].text, /toolError/);
  assert.ok(mock.statuses.get("cascade").includes("cascade:single"));

  delete process.env.CASCADE_CONFIG;
  delete process.env.CASCADE_STATE_DIR;
});
