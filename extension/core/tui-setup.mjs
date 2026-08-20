import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { ModelSelectorComponent, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getGlobalConfigPath, getProjectConfigPath } from "./config.mjs";
import { VALID_THINKING_LEVELS } from "./defaults.mjs";
import { isContributorModel } from "./privacy.mjs";
import { atomicWriteJson, deepClone, deepMerge } from "./util.mjs";
import { modelId } from "./pi-parity.mjs";
import { getCascadeGlobalCompaction, writeCascadeGlobalCompaction } from "./pi-settings.mjs";

export const SETUP_OPTIONS = Object.freeze({
  scopeSession: "Session only",
  scopeProject: "This project (.cascade/config.json)",
  scopeGlobal: "All projects (~/.config/cascade/config.json)",
  modeSingle: "Single model",
  modeDual: "Worker + on-demand expert",
  workerNative: "Use the current Cascade model (/model)",
  workerFixed: "Choose worker with Pi's searchable model picker",
  keepBudgets: "Keep current budgets",
  editBudgets: "Edit budgets"
});

function readObject(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function persistCascadeConfig({ cwd, scope, config }) {
  if (scope === "session") return { scope, path: undefined, config };
  const path = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(cwd);
  const merged = deepMerge(readObject(path), config);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, merged, 0o600);
  return { scope, path, config: merged };
}

function modelKey(model) {
  return `${model?.provider || ""}/${modelId(model)}`;
}

function models(ctx) {
  const values = [...(ctx.modelRegistry?.getAll?.() || [])];
  if (ctx.model && !values.some((value) => modelKey(value) === modelKey(ctx.model))) values.push(ctx.model);
  const seen = new Set();
  return values
    .filter((value) => value?.provider && modelId(value))
    .filter((value) => {
      const key = modelKey(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => modelKey(a).localeCompare(modelKey(b)));
}

function readyKeys(ctx) {
  return new Set((ctx.modelRegistry?.getAvailable?.() || []).map(modelKey));
}

export function listProviderChoices(ctx) {
  const catalog = models(ctx);
  const ready = readyKeys(ctx);
  return [...new Set(catalog.map((model) => model.provider))].sort().map((provider) => {
    const available = catalog.some((model) => model.provider === provider && ready.has(modelKey(model)));
    const display = ctx.modelRegistry?.getProviderDisplayName?.(provider) || provider;
    return { provider, ready: available, label: `${display} · ${provider} · ${available ? "ready" : "login required"}` };
  });
}

export function listRoleModelChoices(ctx, provider) {
  const ready = readyKeys(ctx);
  return models(ctx).filter((model) => !provider || model.provider === provider).map((model) => {
    const id = modelId(model);
    const available = ready.has(modelKey(model));
    const display = model.name && model.name !== id ? `${model.name} · ${id}` : id;
    return { model, ready: available, label: `${display} · ${available ? "ready" : "login required"}` };
  });
}

function modelRuntimeAdapter(ctx) {
  return {
    refresh(options) {
      if (typeof ctx.modelRegistry?.refresh === "function") return ctx.modelRegistry.refresh(options);
      return Promise.resolve({ aborted: false, errors: new Map() });
    },
    getAvailableSnapshot() {
      return [...(ctx.modelRegistry?.getAvailable?.() || [])];
    },
    getModel(provider, id) {
      return ctx.modelRegistry?.find?.(provider, id);
    },
    getError() {
      return ctx.modelRegistry?.getError?.();
    }
  };
}

/**
 * Use Pi's own ModelSelectorComponent so Cascade gets the same fuzzy search,
 * provider availability, keyboard behavior, and catalog refresh as /model.
 * Selecting a role model here does not change the active chat model.
 */
export async function pickModelWithNativeUi(ctx, current) {
  if (!ctx?.hasUI || typeof ctx.ui?.custom !== "function") {
    throw new Error("Model selection requires the interactive Cascade TUI");
  }
  const configured = current?.provider && current?.model
    ? ctx.modelRegistry?.find?.(current.provider, current.model)
    : undefined;
  const currentModel = configured || ctx.model;
  const settingsManager = SettingsManager.inMemory();
  const runtime = modelRuntimeAdapter(ctx);

  return ctx.ui.custom((tui, _theme, _keybindings, done) => {
    const component = new ModelSelectorComponent(
      tui,
      currentModel,
      settingsManager,
      runtime,
      [],
      (model) => done(model),
      () => done(null)
    );
    component.focused = true;
    return {
      render: (width) => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: (data) => {
        component.handleInput(data);
        tui.requestRender();
      },
      dispose: () => component.dispose?.()
    };
  });
}

async function chooseScope(ctx) {
  const selected = await ctx.ui.select("Cascade setup · Save settings", [
    SETUP_OPTIONS.scopeSession,
    SETUP_OPTIONS.scopeProject,
    SETUP_OPTIONS.scopeGlobal
  ]);
  if (selected === SETUP_OPTIONS.scopeProject) return "project";
  if (selected === SETUP_OPTIONS.scopeGlobal) return "global";
  if (selected === SETUP_OPTIONS.scopeSession) return "session";
  return undefined;
}

async function chooseModel(ctx, role, current) {
  const selectedModel = await pickModelWithNativeUi(ctx, current);
  if (!selectedModel) return undefined;
  const provider = selectedModel.provider;
  const available = readyKeys(ctx).has(modelKey(selectedModel));
  return {
    provider,
    ready: available,
    profile: {
      ...deepClone(current || {}),
      selectionMode: "configured",
      thinkingMode: "configured",
      restrictTools: Boolean(current?.restrictTools),
      provider,
      model: modelId(selectedModel)
    }
  };
}

async function chooseThinking(ctx, role, current) {
  const levels = [...VALID_THINKING_LEVELS];
  const selected = await ctx.ui.select(`Cascade · ${role} thinking`, levels);
  return selected ? { thinkingMode: "configured", thinking: selected } : undefined;
}

async function positiveNumber(ctx, title, current, { integer = false } = {}) {
  for (;;) {
    const text = await ctx.ui.input(title, String(current));
    if (text === undefined) return undefined;
    const value = Number(text);
    if (Number.isFinite(value) && value > 0 && (!integer || Number.isInteger(value))) return value;
    ctx.ui.notify(`${title} must be a positive ${integer ? "integer" : "number"}.`, "error");
  }
}

export async function chooseLoginProvider(ctx, preferred) {
  const choices = listProviderChoices(ctx);
  if (preferred && choices.some((choice) => choice.provider === preferred)) return preferred;
  const label = await ctx.ui.select("Cascade · Authenticate provider", choices.map((choice) => choice.label));
  return choices.find((choice) => choice.label === label)?.provider;
}

export function prepareNativeLogin(ctx, provider) {
  if (!provider) return false;
  ctx.ui.setEditorText(`/login ${provider}`);
  ctx.ui.notify(`Authentication command prepared for ${provider}. Press Enter.`, "info");
  return true;
}

function summary(config, scope) {
  const worker = config.worker.selectionMode === "native"
    ? "current /model selection"
    : `${config.worker.provider}/${config.worker.model}`;
  return [
    `Save: ${scope}`,
    `Mode: ${config.mode}`,
    `Worker: ${worker}`,
    `Expert: ${config.mode === "dual" ? `${config.expert.provider}/${config.expert.model}` : "off"}`,
    `Automatic consultation: ${config.routing.autoConsult ? "on" : "off"}`,
    `Privacy: ${config.privacy.classification}`,
    `Contributor endpoints: ${config.privacy.allowContributor ? "allowed" : "blocked"}`
  ].join("\n");
}

export async function runCascadeSetup({ ctx, config }) {
  if (!ctx?.hasUI) throw new Error("Cascade setup requires the interactive TUI");
  const scope = await chooseScope(ctx);
  if (!scope) return { cancelled: true };
  const next = deepClone(config);
  const mode = await ctx.ui.select("Cascade setup · Mode", [SETUP_OPTIONS.modeSingle, SETUP_OPTIONS.modeDual]);
  if (!mode) return { cancelled: true };
  next.mode = mode === SETUP_OPTIONS.modeDual ? "dual" : "single";

  const workerChoice = await ctx.ui.select("Cascade setup · Worker", [SETUP_OPTIONS.workerNative, SETUP_OPTIONS.workerFixed]);
  if (!workerChoice) return { cancelled: true };
  const missing = [];
  if (workerChoice === SETUP_OPTIONS.workerNative) {
    next.worker = {
      ...next.worker,
      selectionMode: "native",
      thinkingMode: "native",
      restrictTools: false,
      ...(ctx.model ? { provider: ctx.model.provider, model: modelId(ctx.model) } : {})
    };
  } else {
    const selected = await chooseModel(ctx, "Worker", next.worker);
    if (!selected) return { cancelled: true };
    const thinking = await chooseThinking(ctx, "Worker", selected.profile);
    if (!thinking) return { cancelled: true };
    next.worker = { ...selected.profile, ...thinking };
    if (!selected.ready) missing.push(selected.provider);
  }

  if (next.mode === "dual") {
    const selected = await chooseModel(ctx, "Expert", next.expert);
    if (!selected) return { cancelled: true };
    const thinking = await chooseThinking(ctx, "Expert", selected.profile);
    if (!thinking) return { cancelled: true };
    next.expert = { ...selected.profile, ...thinking };
    if (!selected.ready) missing.push(selected.provider);
    next.routing.autoConsult = await ctx.ui.confirm(
      "Cascade setup · Automatic expert consultation",
      "Consult the expert only when trajectory evidence crosses the configured threshold?"
    );
  } else {
    next.routing.autoConsult = false;
  }

  const classification = await ctx.ui.select("Cascade setup · Repository privacy", [
    "unknown", "public", "internal", "confidential", "regulated"
  ]);
  if (!classification) return { cancelled: true };
  next.privacy.classification = classification;
  next.privacy.allowContributor = false;
  const contributor = [next.worker, next.mode === "dual" ? next.expert : undefined]
    .filter(Boolean)
    .some((profile) => isContributorModel(profile, next.privacy.contributorPattern));
  if (contributor && classification === "public") {
    next.privacy.allowContributor = await ctx.ui.confirm(
      "Cascade setup · Contributor endpoint",
      "Allow public repository content to be sent to the selected Contributor endpoint?"
    );
  } else if (contributor) {
    ctx.ui.notify("Contributor endpoints remain blocked for non-public repositories.", "warning");
  }

  const budgetChoice = await ctx.ui.select("Cascade setup · Budgets", [SETUP_OPTIONS.keepBudgets, SETUP_OPTIONS.editBudgets]);
  if (!budgetChoice) return { cancelled: true };
  if (budgetChoice === SETUP_OPTIONS.editBudgets) {
    const calls = await positiveNumber(ctx, "Maximum expert calls", next.budgets.maxExpertCalls, { integer: true });
    const expertCost = await positiveNumber(ctx, "Maximum expert cost (USD)", next.budgets.maxExpertCostUsd);
    const sessionCost = await positiveNumber(ctx, "Maximum session cost (USD)", next.budgets.maxSessionEstimatedCostUsd);
    if ([calls, expertCost, sessionCost].some((value) => value === undefined)) return { cancelled: true };
    next.budgets.maxExpertCalls = calls;
    next.budgets.maxExpertCostUsd = expertCost;
    next.budgets.maxSessionEstimatedCostUsd = sessionCost;
  }

  if (!await ctx.ui.confirm("Save Cascade settings?", summary(next, scope))) return { cancelled: true };
  const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });
  let loginProvider;
  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length && await ctx.ui.confirm(
    "Authentication required",
    `No Cascade credential is available for ${uniqueMissing.join(", ")}. Prepare /login now?`
  )) {
    loginProvider = await chooseLoginProvider(ctx, uniqueMissing[0]);
  }
  return { cancelled: false, config: next, scope, path: persisted.path, loginProvider };
}

export async function runRoleModelPicker({ ctx, config, role }) {
  if (!ctx?.hasUI) throw new Error("Model selection requires the interactive TUI");
  if (!new Set(["worker", "expert"]).has(role)) throw new Error("Role must be worker or expert");
  const next = deepClone(config);
  if (role === "worker") {
    const strategy = await ctx.ui.select("Cascade · Worker", [SETUP_OPTIONS.workerNative, SETUP_OPTIONS.workerFixed]);
    if (!strategy) return { cancelled: true };
    if (strategy === SETUP_OPTIONS.workerNative) {
      next.worker = {
        ...next.worker,
        selectionMode: "native",
        thinkingMode: "native",
        restrictTools: false,
        ...(ctx.model ? { provider: ctx.model.provider, model: modelId(ctx.model) } : {})
      };
      const scope = await chooseScope(ctx);
      if (!scope) return { cancelled: true };
      const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });
      return { cancelled: false, config: next, scope, path: persisted.path };
    }
  }
  const selected = await chooseModel(ctx, role === "worker" ? "Worker" : "Expert", next[role]);
  if (!selected) return { cancelled: true };
  const thinking = await chooseThinking(ctx, role === "worker" ? "Worker" : "Expert", selected.profile);
  if (!thinking) return { cancelled: true };
  next[role] = { ...selected.profile, ...thinking };
  const scope = await chooseScope(ctx);
  if (!scope) return { cancelled: true };
  const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });
  return { cancelled: false, config: next, scope, path: persisted.path, loginProvider: selected.ready ? undefined : selected.provider };
}

export async function runCompactionSetup(ctx) {
  const current = getCascadeGlobalCompaction();
  const enabled = await ctx.ui.confirm("Cascade compaction", "Enable automatic compaction globally?");
  const reserveTokens = await positiveNumber(ctx, "Reserved response tokens", current.compaction.reserveTokens, { integer: true });
  const keepRecentTokens = await positiveNumber(ctx, "Recent tokens kept verbatim", current.compaction.keepRecentTokens, { integer: true });
  if (reserveTokens === undefined || keepRecentTokens === undefined) return { cancelled: true };
  return { cancelled: false, ...writeCascadeGlobalCompaction({ enabled, reserveTokens, keepRecentTokens }) };
}
