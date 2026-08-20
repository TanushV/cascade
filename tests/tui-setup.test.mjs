import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { SETUP_OPTIONS, listProviderChoices, prepareNativeLogin, runCascadeSetup } from "../extension/core/tui-setup.mjs";

function model(provider, id, name = id) { return { provider, id, name }; }

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
      getProviderDisplayName: (provider) => provider
    },
    ui: {
      async select(title, options) {
        if (title.includes("Save settings")) return SETUP_OPTIONS.scopeProject;
        if (title.includes("Mode")) return SETUP_OPTIONS.modeDual;
        if (title.includes("Worker")) return SETUP_OPTIONS.workerNative;
        if (title.includes("Expert provider")) return options[0];
        if (title.includes("Expert model")) return options.find((value) => value.includes("strong-expert"));
        if (title.includes("Expert thinking")) return "high";
        if (title.includes("Repository privacy")) return "confidential";
        if (title.includes("Budgets")) return SETUP_OPTIONS.keepBudgets;
        throw new Error(`Unexpected selector ${title}`);
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
  return { ctx, editors, notifications };
}

test("setup persists a native worker and configured expert without secrets", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-setup-"));
  const { ctx } = fakeContext(cwd);
  const result = await runCascadeSetup({ ctx, config: structuredClone(DEFAULT_CONFIG) });
  assert.equal(result.cancelled, false);
  assert.equal(result.config.mode, "dual");
  assert.equal(result.config.worker.selectionMode, "native");
  assert.equal(result.config.expert.model, "strong-expert");
  assert.equal(result.config.privacy.allowContributor, false);
  const path = join(cwd, ".cascade", "config.json");
  assert.equal(existsSync(path), true);
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("sk-or-"), false);
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
