import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

function context(cwd, sessionId = "integration-session") {
  return {
    cwd,
    model: undefined,
    signal: undefined,
    modelRegistry: { find(provider, id) { return { provider, id, maxTokens: 10000 }; } },
    sessionManager: { getSessionId() { return sessionId; } },
    isProjectTrusted() { return true; },
    hasPendingMessages() { return false; },
    abort() { this.aborted = true; }
  };
}

function withCascadeEnvironment(configPath, statePath) {
  process.env.PI_CASCADE_CONFIG = configPath;
  process.env.PI_CASCADE_STATE_DIR = statePath;
  return () => {
    delete process.env.PI_CASCADE_CONFIG;
    delete process.env.PI_CASCADE_STATE_DIR;
  };
}

test("dual extension runs a fully configured isolated expert consultation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-dual-extension-"));
  const fake = join(dir, "fake-pi.mjs");
  writeFileSync(fake, `#!/usr/bin/env node\nconst response={decision:'continue-worker',summary:'preserve the parser invariant',findings:[{claim:'x',evidence:'packet',confidence:.9}],patchConstraints:[],requiredEvidence:[],nextAction:'run parser test',risks:[],confidence:.9};\nconsole.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify(response)}],usage:{input:100,output:20,cost:{total:0.02}}}}));\n`, "utf8");
  chmodSync(fake, 0o755);
  const configPath = join(dir, "cascade.json");
  const statePath = join(dir, "state");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    mode: "dual",
    piBinary: fake,
    worker: { provider: "openrouter", model: "worker", thinking: "low", tools: ["read", "bash", "edit"] },
    expert: { provider: "openrouter", model: "expert", thinking: "high", tools: ["read", "grep", "bash"], timeoutMs: 5000 },
    privacy: { classification: "internal", allowContributor: false },
    routing: { autoConsult: false }
  }));
  const cleanup = withCascadeEnvironment(configPath, statePath);
  try {
    const ctx = context(dir, "dual-session");
    const mock = createMockPi(ctx);
    cascadeExtension(mock.pi);
    await emit(mock, "session_start", { type: "session_start", reason: "startup" }, ctx);
    assert.ok(mock.activeTools.includes("cascade_expert"));
    const result = await mock.tools.get("cascade_expert").execute(
      "expert-1",
      { question: "Which invariant constrains the patch?", mode: "consult" },
      undefined,
      undefined,
      ctx
    );
    assert.equal(result.isError, false);
    assert.match(result.content[0].text, /preserve the parser invariant/);
    assert.equal(mock.entries.at(-1).type, "pi-cascade.expert");
    const ledger = readFileSync(join(statePath, "dual-session.jsonl"), "utf8");
    assert.match(ledger, /expert_consultation/);
  } finally {
    cleanup();
  }
});

test("contributor input is redacted, images are denied, and protected paths are blocked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-contributor-extension-"));
  const configPath = join(dir, "cascade.json");
  const statePath = join(dir, "state");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    mode: "single",
    worker: { provider: "meta-model-api", model: "muse-spark-1.2-contributor", thinking: "low", tools: ["read", "bash"] },
    privacy: { classification: "public", allowContributor: true, allowImagesToContributor: false, redactSecrets: true }
  }));
  const cleanup = withCascadeEnvironment(configPath, statePath);
  try {
    const ctx = context(dir, "privacy-session");
    const mock = createMockPi(ctx);
    cascadeExtension(mock.pi);
    await emit(mock, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const transformed = await emit(mock, "input", {
      text: "fix this api_key=supersecretvalue",
      source: "interactive"
    }, ctx);
    assert.equal(transformed.action, "transform");
    assert.doesNotMatch(transformed.text, /supersecretvalue/);
    assert.match(transformed.text, /REDACTED/);
    const image = await emit(mock, "input", {
      text: "inspect image",
      images: [{ type: "image", data: "x", mimeType: "image/png" }],
      source: "interactive"
    }, ctx);
    assert.deepEqual(image, { action: "handled" });
    const blocked = await emit(mock, "tool_call", {
      toolName: "read",
      input: { path: ".env" },
      toolCallId: "secret"
    }, ctx);
    assert.equal(blocked.block, true);
    assert.equal(blocked.terminate, true);
  } finally {
    cleanup();
  }
});

test("session cost budget blocks later prompts after recorded worker usage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-budget-extension-"));
  const configPath = join(dir, "cascade.json");
  const statePath = join(dir, "state");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    mode: "single",
    worker: { provider: "meta-model-api", model: "muse-spark-1.2-contributor", thinking: "low", tools: ["read"] },
    privacy: { classification: "public", allowContributor: true },
    budgets: { maxSessionEstimatedCostUsd: 0.001 }
  }));
  const cleanup = withCascadeEnvironment(configPath, statePath);
  try {
    const ctx = context(dir, "budget-session");
    const mock = createMockPi(ctx);
    cascadeExtension(mock.pi);
    await emit(mock, "session_start", { type: "session_start", reason: "startup" }, ctx);
    await emit(mock, "message_end", {
      message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 1_000_000, output: 0 } }
    }, ctx);
    const blocked = await emit(mock, "input", { text: "continue", source: "interactive" }, ctx);
    assert.deepEqual(blocked, { action: "handled" });
    assert.ok(mock.notifications.some((item) => /budget exhausted/i.test(item.message)));
  } finally {
    cleanup();
  }
});

test("completion gate verifies a real changed Git worktree before accepting settlement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-completion-git-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Cascade Test"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
  writeFileSync(join(dir, "tracked.txt"), "before\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: dir });

  const configPath = join(dir, "cascade.json");
  const statePath = join(dir, "state");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    mode: "single",
    worker: { provider: "openrouter", model: "worker", thinking: "low", tools: ["read", "bash", "edit"] },
    privacy: { classification: "internal", allowContributor: false },
    verification: { requireBeforeCompletion: true, autoRunBeforeCompletion: true, maxCompletionGateRuns: 1, timeoutMs: 10000 }
  }));
  const cleanup = withCascadeEnvironment(configPath, statePath);
  try {
    const ctx = context(dir, "completion-session");
    const mock = createMockPi(ctx);
    cascadeExtension(mock.pi);
    await emit(mock, "session_start", { type: "session_start", reason: "startup" }, ctx);
    writeFileSync(join(dir, "tracked.txt"), "after\n");
    await emit(mock, "agent_settled", { type: "agent_settled" }, ctx);
    const ledger = readFileSync(join(statePath, "completion-session.jsonl"), "utf8");
    assert.match(ledger, /completion_verification/);
    assert.match(ledger, /\"ok\":true/);
    assert.ok(mock.notifications.some((item) => /verification passed/i.test(item.message)));
  } finally {
    cleanup();
  }
});

test("a successful non-verifier command cannot bypass the completion gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-false-verifier-git-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Cascade Test"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
  writeFileSync(join(dir, "tracked.txt"), "before\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: dir });

  const configPath = join(dir, "cascade.json");
  const statePath = join(dir, "state");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    mode: "single",
    worker: { provider: "openrouter", model: "worker", thinking: "low", tools: ["read", "bash", "edit"] },
    privacy: { classification: "internal", allowContributor: false },
    verification: { requireBeforeCompletion: true, autoRunBeforeCompletion: true, maxCompletionGateRuns: 1, timeoutMs: 10000 }
  }));
  const cleanup = withCascadeEnvironment(configPath, statePath);
  try {
    const ctx = context(dir, "false-verifier-session");
    const mock = createMockPi(ctx);
    cascadeExtension(mock.pi);
    await emit(mock, "session_start", { type: "session_start", reason: "startup" }, ctx);
    writeFileSync(join(dir, "tracked.txt"), "after\n");
    await emit(mock, "tool_result", {
      toolName: "bash",
      toolCallId: "echo-test",
      input: { command: "echo test" },
      content: [{ type: "text", text: "test" }],
      isError: false
    }, ctx);
    await emit(mock, "agent_settled", { type: "agent_settled" }, ctx);
    const ledger = readFileSync(join(statePath, "false-verifier-session.jsonl"), "utf8");
    assert.match(ledger, /completion_verification/);
    assert.doesNotMatch(ledger, /Verification passed: echo test/);
  } finally {
    cleanup();
  }
});
