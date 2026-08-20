import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectSelectableModels,
  currentPiModel,
  runCascadeSetup
} from "../extension/core/tui-setup.mjs";

function setupContext(cwd, decisions = {}) {
  const notifications = [];
  const ctx = {
    cwd,
    model: { provider: "openrouter", id: "vendor/current", name: "Current" },
    modelRegistry: {
      getAvailable() {
        return [
          { provider: "openrouter", id: "vendor/worker", name: "Worker" },
          { provider: "openrouter", id: "vendor/expert", name: "Expert" }
        ];
      }
    },
    ui: {
      async select(title, options) {
        if (title.includes("save scope")) return options[0];
        if (title.includes("mode")) return options.find((value) => value.startsWith("Dual"));
        if (title.includes("worker model")) return options.find((value) => value.includes("vendor/worker"));
        if (title.includes("expert model")) return options.find((value) => value.includes("vendor/expert"));
        if (title.includes("worker thinking")) return options.find((value) => value === "medium" || value === "Keep medium");
        if (title.includes("expert thinking")) return options.find((value) => value === "high" || value === "Keep high");
        if (title.includes("automatic expert")) return options.find((value) => value.startsWith("Enabled"));
        if (title.includes("repository privacy")) return options.find((value) => value.startsWith("internal"));
        return decisions[title] || options[0];
      },
      async confirm() { return true; },
      notify(message, type) { notifications.push({ message, type }); }
    }
  };
  return { ctx, notifications };
}

function baseConfig() {
  return {
    schemaVersion: 1,
    mode: "single",
    worker: {
      useNativeModel: true,
      provider: "meta-model-api",
      model: "muse-spark-1.2-contributor",
      thinking: "medium",
      tools: ["read", "edit", "write"]
    },
    expert: {
      useNativeModel: false,
      provider: "openrouter",
      model: "openrouter/auto",
      thinking: "high",
      tools: ["read", "grep", "bash"]
    },
    routing: { autoConsult: false },
    privacy: {
      classification: "unknown",
      allowContributor: false,
      contributorPattern: "contributor"
    }
  };
}

test("model collection includes the active Pi model and available registry models", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-tui-models-"));
  const { ctx } = setupContext(cwd);
  assert.deepEqual(currentPiModel(ctx), {
    provider: "openrouter",
    model: "vendor/current",
    name: "Current",
    reasoning: true
  });
  const refs = collectSelectableModels(ctx).map((model) => `${model.provider}/${model.model}`);
  assert.deepEqual(refs, [
    "openrouter/vendor/current",
    "openrouter/vendor/expert",
    "openrouter/vendor/worker"
  ]);
});

test("TUI setup configures worker and expert and persists project config without secrets", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-tui-setup-"));
  const { ctx } = setupContext(cwd);
  const result = await runCascadeSetup({ ctx, config: baseConfig(), cwd });
  assert.equal(result.cancelled, false);
  assert.equal(result.scope, "project");
  assert.equal(result.config.mode, "dual");
  assert.equal(result.config.worker.provider, "openrouter");
  assert.equal(result.config.worker.model, "vendor/worker");
  assert.equal(result.config.expert.provider, "openrouter");
  assert.equal(result.config.expert.model, "vendor/expert");
  assert.equal(result.config.routing.autoConsult, true);
  assert.equal(result.config.privacy.classification, "internal");
  assert.equal(result.config.privacy.allowContributor, false);

  const path = join(cwd, ".cascade", "config.json");
  const persistedText = readFileSync(path, "utf8");
  const persisted = JSON.parse(persistedText);
  assert.equal(persisted.mode, "dual");
  assert.equal(persisted.worker.model, "vendor/worker");
  assert.equal(persisted.expert.model, "vendor/expert");
  assert.equal(persistedText.includes("API_KEY"), false);
  assert.equal(persistedText.includes("sk-"), false);
});

test("TUI setup directs missing credentials to native Pi login without changing config", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-tui-login-"));
  const notifications = [];
  const ctx = {
    cwd,
    model: undefined,
    modelRegistry: { getAvailable: () => [] },
    ui: {
      async select(title, options) {
        if (title.includes("save scope")) return options[2];
        if (title.includes("mode")) return options[0];
        if (title.includes("worker model")) return "Configure credentials first with Pi /login";
        return options[0];
      },
      notify(message, type) { notifications.push({ message, type }); }
    }
  };
  const result = await runCascadeSetup({ ctx, config: baseConfig(), cwd });
  assert.equal(result.cancelled, true);
  assert.equal(result.needsLogin, true);
  assert.ok(notifications.some(({ message }) => message.includes("/login")));
});
