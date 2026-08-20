import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import {
  SETUP_OPTIONS,
  listProviderChoices,
  pickModelWithNativeUi,
  prepareNativeLogin,
  runCascadeSetup,
  runRoleModelPicker
} from "../extension/core/tui-setup.mjs";

function model(provider, id, name = id) { return { provider, id, name }; }

function fakeContext(cwd) {
  const current = model("openrouter", "cheap-worker", "Cheap Worker");
  const strong = model("openrouter", "strong-expert", "Strong Expert");
  const all = [current, strong];
  const editors = [];
  const notifications = [];
  const customCalls = [];
  const selectTitles = [];
  const ctx = {
    cwd,
    mode: "tui",
    hasUI: true,
    model: current,
    modelRegistry: {
      getAll: () => all,
      getAvailable: () => all,
      getProviderDisplayName: (provider) => provider,
      find(provider, id) { return all.find((entry) => entry.provider === provider && entry.id === id); },
      async refresh() { return { aborted: false, errors: new Map() }; },
      getError() { return undefined; }
    },
    ui: {
      async select(title, options) {
        selectTitles.push(title);
        if (title.includes("Save settings")) return SETUP_OPTIONS.scopeProject;
        if (title.includes("Mode")) return SETUP_OPTIONS.modeDual;
        if (title === "Cascade setup · Worker") return SETUP_OPTIONS.workerNative;
        if (title.includes("Expert thinking")) return "high";
        if (title.includes("Repository privacy")) return "confidential";
        if (title.includes("Budgets")) return SETUP_OPTIONS.keepBudgets;
        throw new Error(`Unexpected selector ${title}: ${options.join(", ")}`);
      },
      async custom(factory) {
        customCalls.push(factory);
        return strong;
      },
      async confirm(title) {
        if (title.includes("Automatic expert")) return true;
        if (title.includes("Save Cascade")) return true;
        return false;
      },
      async input() { throw new Error("Unexpected numeric input"); },
      setEditorText(value) { editors.push(value); },
      notify(message, type) { notifications.push({ message, type }); }
    }
  };
  return { ctx, current, strong, editors, notifications, customCalls, selectTitles };
}

test("setup persists a native worker and configured expert without secrets", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-setup-"));
  const { ctx, customCalls, selectTitles } = fakeContext(cwd);
  const result = await runCascadeSetup({ ctx, config: structuredClone(DEFAULT_CONFIG) });
  assert.equal(result.cancelled, false);
  assert.equal(result.config.mode, "dual");
  assert.equal(result.config.worker.selectionMode, "native");
  assert.equal(result.config.expert.model, "strong-expert");
  assert.equal(result.config.privacy.allowContributor, false);
  assert.equal(customCalls.length, 1, "expert selection should use Pi's native custom model selector");
  assert.equal(selectTitles.some((title) => /provider|Expert model/.test(title)), false, "Cascade must not render a second provider/model list");
  const path = join(cwd, ".cascade", "config.json");
  assert.equal(existsSync(path), true);
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("sk-or-"), false);
});

test("role model selection delegates to Pi's searchable selector", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-role-picker-"));
  const { ctx, customCalls, selectTitles } = fakeContext(cwd);
  const result = await runRoleModelPicker({ ctx, config: structuredClone(DEFAULT_CONFIG), role: "expert" });
  assert.equal(result.cancelled, false);
  assert.equal(result.config.expert.provider, "openrouter");
  assert.equal(result.config.expert.model, "strong-expert");
  assert.equal(customCalls.length, 1);
  assert.equal(selectTitles.some((title) => /provider|Expert model/.test(title)), false);
});

test("native picker is supplied through ctx.ui.custom", async () => {
  const { ctx, strong, customCalls } = fakeContext(mkdtempSync(join(tmpdir(), "cascade-native-picker-")));
  const selected = await pickModelWithNativeUi(ctx, { provider: "openrouter", model: "cheap-worker" });
  assert.equal(selected, strong);
  assert.equal(customCalls.length, 1);
  assert.equal(typeof customCalls[0], "function");
});

test("provider choices are taken from the active Cascade model registry", () => {
  const { ctx } = fakeContext(mkdtempSync(join(tmpdir(), "cascade-models-")));
  const choices = listProviderChoices(ctx);
  assert.deepEqual(choices.map((choice) => choice.provider), ["openrouter"]);
  assert.equal(choices[0].ready, true);
});

test("authentication preparation uses the engine's native login command", () => {
  const { ctx, editors } = fakeContext(mkdtempSync(join(tmpdir(), "cascade-auth-")));
  assert.equal(prepareNativeLogin(ctx, "openrouter"), true);
  assert.deepEqual(editors, ["/login openrouter"]);
});
