import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExampleConfig, loadEffectiveConfig, validateConfig } from "../extension/core/config.mjs";

test("configuration merges trusted project and environment overrides", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-config-"));
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "cascade.json"), JSON.stringify({
    schemaVersion: 1,
    mode: "dual",
    worker: { provider: "project", model: "worker" },
    privacy: { classification: "public", allowContributor: true }
  }));
  const env = {
    ...process.env,
    CASCADE_WORKER: "openrouter/google/gemini-test",
    CASCADE_EXPERT: "openrouter/anthropic/expert-test",
    CASCADE_MODE: "single",
    CASCADE_ALLOW_CONTRIBUTOR: "0",
    CASCADE_WORKER_TOOLS: "read,grep,bash",
    CASCADE_WORKER_INSTRUCTIONS: "worker override",
    CASCADE_EXPERT_TOOLS: '["read","grep"]',
    CASCADE_EXPERT_INSTRUCTIONS: "expert override",
    CASCADE_EXPERT_TIMEOUT_MS: "12345",
    CASCADE_EXPERT_MAX_OUTPUT_CHARACTERS: "54321",
    CASCADE_MAX_EXPERT_CALLS: "2",
    CASCADE_MAX_EXPERT_COST_USD: "1.5",
    CASCADE_MAX_SESSION_COST_USD: "3.5"
  };
  const result = loadEffectiveConfig({ cwd, projectTrusted: true, env });
  assert.equal(result.config.mode, "single");
  assert.equal(result.config.worker.provider, "openrouter");
  assert.equal(result.config.worker.model, "google/gemini-test");
  assert.equal(result.config.expert.model, "anthropic/expert-test");
  assert.equal(result.config.privacy.allowContributor, false);
  assert.deepEqual(result.config.worker.tools, ["read", "grep", "bash"]);
  assert.equal(result.config.worker.instructions, "worker override");
  assert.deepEqual(result.config.expert.tools, ["read", "grep"]);
  assert.equal(result.config.expert.instructions, "expert override");
  assert.equal(result.config.expert.timeoutMs, 12345);
  assert.equal(result.config.expert.maxOutputCharacters, 54321);
  assert.equal(result.config.budgets.maxExpertCalls, 2);
  assert.equal(result.config.budgets.maxExpertCostUsd, 1.5);
  assert.equal(result.config.budgets.maxSessionEstimatedCostUsd, 3.5);
  assert.ok(result.sources.some((source) => source.type === "project"));
});

test("untrusted project configuration is ignored", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-untrusted-"));
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "cascade.json"), JSON.stringify({
    schemaVersion: 1,
    worker: { provider: "malicious", model: "redirect" }
  }));
  const result = loadEffectiveConfig({ cwd, projectTrusted: false, env: { ...process.env, CASCADE_MODE: "single" } });
  assert.notEqual(result.config.worker.provider, "malicious");
  assert.ok(!result.sources.some((source) => source.type === "project"));
});

test("example configuration validates and requires explicit Contributor opt-in", () => {
  const example = createExampleConfig();
  assert.equal(example.privacy.classification, "unknown");
  assert.equal(example.privacy.allowContributor, false);
  const validation = validateConfig({
    ...loadEffectiveConfig({ cwd: process.cwd(), projectTrusted: false, env: { ...process.env, CASCADE_MODE: "single" } }).config,
    ...example
  });
  assert.deepEqual(validation.errors, []);
});

test("enabled programmatic workspace requires an explicit sandbox decision", () => {
  const config = createExampleConfig();
  config.workspaceRuntime = {
    enabled: true,
    pythonBinary: "python3",
    sandboxCommand: [],
    allowUnsandboxed: false,
    timeoutMs: 1000,
    maxCodeCharacters: 1000,
    maxOutputCharacters: 1000,
    maxStateCharacters: 1000,
    statePath: ""
  };
  const effective = loadEffectiveConfig({
    cwd: process.cwd(),
    projectTrusted: false,
    env: { ...process.env, CASCADE_MODE: "single" },
    throwOnError: false
  }).config;
  const validation = validateConfig({ ...effective, ...config });
  assert.ok(validation.errors.some((error) => error.includes("requires sandboxCommand")));
  config.workspaceRuntime.allowUnsandboxed = true;
  const allowed = validateConfig({ ...effective, ...config });
  assert.equal(allowed.errors.some((error) => error.includes("workspaceRuntime")), false);
});
