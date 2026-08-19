import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import {
  SETUP_OPTIONS,
  listProviderChoices,
  prepareNativeLogin,
  runCascadeSetup
} from "../extension/core/tui-setup.mjs";

function model(provider, id, name = id) {
  return { provider, id, name };
}

function fakeContext(cwd) {
  const current = model("openrouter", "cheap-worker", "Cheap Worker");
  const strong = model("openrouter", "strong-expert", "Strong Expert");
  const all = [current, strong];
  const editors = [];
  const notifications = [];
  const ctx = {
    cwd,
    hasUI: true,
    model: current,
    modelRegistry: {
      getAll: () => all,
      getAvailable: () => all,
      getProviderDisplayName: (provider) => provider === "openrouter" ? "OpenRouter" : provider
    },
    ui: {
      async select(title, options) {
        if (title.includes("Save settings")) return SETUP_OPTIONS.scopeProject;
        if (title.includes("Operating mode")) return SETUP_OPTIONS.modeDual;
        if (title.includes("Worker model")) return SETUP_OPTIONS.workerNative;
        if (title.includes("Expert provider")) return options.find((value) => value.includes("openrouter"));
        if (title.includes("Expert model")) return options.find((value) => value.includes("strong-expert"));
        if (title.includes("Expert thinking")) return "high";
        if (title.includes("Repository privacy")) return "confidential";
        if (title.includes("Budgets")) return SETUP_OPTIONS.keepBudgets;
        throw new Error(`Unexpected selector: ${title}`);
      },
      async confirm(title) {
        if (title.includes("Automatic expert")) return true;
        if (title.includes("Save Cascade")) return true;
        return false;
      },
      async input() { throw new Error("No numeric input expected"); },
      setEditorText(value) { editors.push(value); },
      notify(message, type) { notifications.push({ message, type }); }
    }
  };
  return { ctx, editors, notifications };
}

test("Cascade defaults preserve native Pi worker selection and tools", () => {
  assert.equal(DEFAULT_CONFIG.worker.selectionMode, "native");
  assert.equal(DEFAULT_CONFIG.worker.thinkingMode, "native");
  assert.equal(DEFAULT_CONFIG.worker.restrictTools, false);
  assert.equal(DEFAULT_CONFIG.expert.restrictTools, false);
});

test("TUI setup configures dual roles and writes project settings without secrets", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-tui-setup-"));
  const { ctx } = fakeContext(cwd);
  const result = await runCascadeSetup({ ctx, config: structuredClone(DEFAULT_CONFIG) });
  assert.equal(result.cancelled, false);
  assert.equal(result.scope, "project");
  assert.equal(result.config.mode, "dual");
  assert.equal(result.config.worker.selectionMode, "native");
  assert.equal(result.config.worker.provider, "openrouter");
  assert.equal(result.config.worker.model, "cheap-worker");
  assert.equal(result.config.expert.provider, "openrouter");
  assert.equal(result.config.expert.model, "strong-expert");
  assert.equal(result.config.routing.autoConsult, true);
  assert.equal(result.config.privacy.classification, "confidential");
  assert.equal(result.config.privacy.allowContributor, false);
  assert.ok(existsSync(join(cwd, ".cascade", "config.json")));
  const saved = readFileSync(join(cwd, ".cascade", "config.json"), "utf8");
  assert.ok(!saved.includes("sk-or-"));
  assert.equal(JSON.parse(saved).expert.model, "strong-expert");
});

test("provider choices use Pi's model registry", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-provider-list-"));
  const { ctx } = fakeContext(cwd);
  const providers = listProviderChoices(ctx);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].provider, "openrouter");
  assert.equal(providers[0].ready, true);
});

test("native authentication preparation uses Pi's /login command", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-auth-"));
  const { ctx, editors, notifications } = fakeContext(cwd);
  assert.equal(prepareNativeLogin(ctx, "openrouter"), true);
  assert.deepEqual(editors, ["/login openrouter"]);
  assert.ok(notifications.some((entry) => entry.message.includes("Press Enter")));
});
