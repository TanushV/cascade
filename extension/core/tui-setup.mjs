import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { getGlobalConfigPath, getProjectConfigPath } from "./config.mjs";
import { VALID_THINKING_LEVELS } from "./defaults.mjs";
import { isContributorModel } from "./privacy.mjs";
import { atomicWriteJson, deepClone } from "./util.mjs";
import { modelId } from "./pi-parity.mjs";

export const SETUP_OPTIONS = Object.freeze({
  scopeSession: "Session only (do not write a file)",
  scopeProject: "This project (.cascade/config.json)",
  scopeGlobal: "All projects (~/.config/cascade/config.json)",
  modeSingle: "Single model (native Pi behavior)",
  modeDual: "Dual model (worker + on-demand expert)",
  workerNative: "Use the current Pi model and native /model picker",
  workerFixed: "Choose a fixed worker model",
  keepBudgets: "Keep current budgets",
  editBudgets: "Edit expert and session budgets"
});

function mergePlain(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return deepClone(patch);
  const result = base && typeof base === "object" && !Array.isArray(base) ? deepClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergePlain(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

function readObject(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function persistCascadeConfig({ cwd, scope, config }) {
  if (scope === "session") return { path: undefined, scope, config };
  const path = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(cwd);
  const merged = mergePlain(readObject(path), config);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, merged, 0o600);
  return { path, scope, config: merged };
}

function modelKey(model) {
  return `${model?.provider || ""}/${modelId(model)}`;
}

function catalogModels(ctx) {
  const models = [...(ctx.modelRegistry?.getAll?.() || [])];
  if (ctx.model && !models.some((model) => modelKey(model) === modelKey(ctx.model))) models.push(ctx.model);
  const seen = new Set();
  return models
    .filter((model) => model?.provider && modelId(model))
    .filter((model) => {
      const key = modelKey(model);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => modelKey(left).localeCompare(modelKey(right)));
}

function readyModelKeys(ctx) {
  return new Set((ctx.modelRegistry?.getAvailable?.() || []).map(modelKey));
}

function providerLabel(ctx, provider, ready) {
  const display = ctx.modelRegistry?.getProviderDisplayName?.(provider) || provider;
  return `${display} · ${provider} · ${ready ? "ready" : "login required"}`;
}

function modelLabel(model, ready) {
  const id = modelId(model);
  const display = model.name && model.name !== id ? `${model.name} · ${id}` : id;
  return `${display} · ${ready ? "ready" : "login required"}`;
}

export function listProviderChoices(ctx) {
  const models = catalogModels(ctx);
  const ready = readyModelKeys(ctx);
  return [...new Set(models.map((model) => model.provider))]
    .sort()
    .map((provider) => {
      const providerReady = models.some(
        (model) => model.provider === provider && ready.has(modelKey(model))
      );
      return {
        provider,
        ready: providerReady,
        label: providerLabel(ctx, provider, providerReady)
      };
    });
}

export function listRoleModelChoices(ctx, provider) {
  const ready = readyModelKeys(ctx);
  return catalogModels(ctx)
    .filter((model) => !provider || model.provider === provider)
    .map((model) => ({
      model,
      ready: ready.has(modelKey(model)),
      label: modelLabel(model, ready.has(modelKey(model)))
    }));
}

async function chooseScope(ctx) {
  const selected = await ctx.ui.select("Cascade setup · Save settings", [
    SETUP_OPTIONS.scopeSession,
    SETUP_OPTIONS.scopeProject,
    SETUP_OPTIONS.scopeGlobal
  ]);
  if (!selected) return undefined;
  if (selected === SETUP_OPTIONS.scopeProject) return "project";
  if (selected === SETUP_OPTIONS.scopeGlobal) return "global";
  return "session";
}

async function chooseProvider(ctx, title) {
  const choices = listProviderChoices(ctx);
  if (!choices.length) {
    ctx.ui.notify("Pi's model catalog is empty. Use /login or configure a provider first.", "warning");
    return undefined;
  }
  const selected = await ctx.ui.select(title, choices.map((choice) => choice.label));
  return choices.find((choice) => choice.label === selected)?.provider;
}

async function chooseFixedModel(ctx, role, current) {
  const provider = await chooseProvider(ctx, `Cascade setup · ${role} provider`);
  if (!provider) return undefined;
  const choices = listRoleModelChoices(ctx, provider);
  const selectedLabel = await ctx.ui.select(
    `Cascade setup · ${role} model`,
    choices.map((choice) => choice.label)
  );
  const selected = choices.find((choice) => choice.label === selectedLabel);
  if (!selected) return undefined;
  return {
    profile: {
      ...deepClone(current || {}),
      selectionMode: "configured",
      thinkingMode: "configured",
      provider: selected.model.provider,
      model: modelId(selected.model),
      restrictTools: Boolean(current?.restrictTools)
    },
    provider: selected.model.provider,
    ready: selected.ready
  };
}

async function chooseThinking(ctx, role, current) {
  const choices = [...VALID_THINKING_LEVELS];
  const preferred = current?.thinking && choices.includes(current.thinking) ? current.thinking : undefined;
  const ordered = preferred ? [preferred, ...choices.filter((choice) => choice !== preferred)] : choices;
  const selected = await ctx.ui.select(`Cascade setup · ${role} thinking`, ordered);
  return selected ? { thinkingMode: "configured", thinking: selected } : undefined;
}

async function choosePositiveNumber(ctx, title, current) {
  const value = await ctx.ui.input(title, String(current));
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    ctx.ui.notify(`${title} must be a positive number.`, "error");
    return choosePositiveNumber(ctx, title, current);
  }
  return parsed;
}

function profileReady(ctx, profile) {
  return readyModelKeys(ctx).has(`${profile?.provider || ""}/${profile?.model || ""}`);
}

export async function chooseLoginProvider(ctx, preferred) {
  const choices = listProviderChoices(ctx);
  if (preferred && choices.some((choice) => choice.provider === preferred)) return preferred;
  if (!choices.length) return preferred;
  const selected = await ctx.ui.select(
    "Cascade · Authenticate provider with Pi",
    choices.map((choice) => choice.label)
  );
  return choices.find((choice) => choice.label === selected)?.provider;
}

export function prepareNativeLogin(ctx, provider) {
  if (!provider) return false;
  ctx.ui.setEditorText(`/login ${provider}`);
  ctx.ui.notify(`Pi's native /login command is ready for ${provider}. Press Enter to authenticate.`, "info");
  return true;
}

function setupSummary(config, scope) {
  const worker = config.worker.selectionMode === "native"
    ? "current Pi model (/model stays authoritative)"
    : `${config.worker.provider}/${config.worker.model}`;
  const expert = config.mode === "dual"
    ? `${config.expert.provider}/${config.expert.model}`
    : "disabled";
  return [
    `Save: ${scope}`,
    `Mode: ${config.mode}`,
    `Worker: ${worker}`,
    `Expert: ${expert}`,
    `Auto-consult: ${config.routing.autoConsult ? "on" : "off"}`,
    `Privacy: ${config.privacy.classification}`,
    `Contributor endpoints: ${config.privacy.allowContributor ? "allowed" : "blocked"}`
  ].join("\n");
}

export async function runCascadeSetup({ ctx, config }) {
  if (!ctx?.hasUI) throw new Error("Cascade setup requires Pi's interactive UI");

  const scope = await chooseScope(ctx);
  if (!scope) return { cancelled: true };

  const next = deepClone(config);
  const mode = await ctx.ui.select("Cascade setup · Operating mode", [
    SETUP_OPTIONS.modeSingle,
    SETUP_OPTIONS.modeDual
  ]);
  if (!mode) return { cancelled: true };
  next.mode = mode === SETUP_OPTIONS.modeDual ? "dual" : "single";

  const workerMode = await ctx.ui.select("Cascade setup · Worker model", [
    SETUP_OPTIONS.workerNative,
    SETUP_OPTIONS.workerFixed
  ]);
  if (!workerMode) return { cancelled: true };

  const missingProviders = [];
  if (workerMode === SETUP_OPTIONS.workerNative) {
    next.worker = {
      ...next.worker,
      selectionMode: "native",
      thinkingMode: "native",
      restrictTools: Boolean(next.worker?.restrictTools)
    };
    if (ctx.model) {
      next.worker.provider = ctx.model.provider;
      next.worker.model = modelId(ctx.model);
    }
  } else {
    const selectedWorker = await chooseFixedModel(ctx, "Worker", next.worker);
    if (!selectedWorker) return { cancelled: true };
    const thinking = await chooseThinking(ctx, "Worker", selectedWorker.profile);
    if (!thinking) return { cancelled: true };
    next.worker = { ...selectedWorker.profile, ...thinking };
    if (!selectedWorker.ready) missingProviders.push(selectedWorker.provider);
  }

  if (next.mode === "dual") {
    const selectedExpert = await chooseFixedModel(ctx, "Expert", next.expert);
    if (!selectedExpert) return { cancelled: true };
    const thinking = await chooseThinking(ctx, "Expert", selectedExpert.profile);
    if (!thinking) return { cancelled: true };
    next.expert = { ...selectedExpert.profile, ...thinking };
    if (!selectedExpert.ready) missingProviders.push(selectedExpert.provider);
    next.routing.autoConsult = await ctx.ui.confirm(
      "Cascade setup · Automatic expert consultation",
      "Allow Cascade to consult the expert automatically when trajectory evidence crosses the configured threshold?"
    );
  } else {
    next.routing.autoConsult = false;
  }

  const classification = await ctx.ui.select("Cascade setup · Repository privacy", [
    "unknown",
    "public",
    "internal",
    "confidential",
    "regulated"
  ]);
  if (!classification) return { cancelled: true };
  next.privacy.classification = classification;

  const contributorSelected = [next.worker, next.mode === "dual" ? next.expert : undefined]
    .filter(Boolean)
    .some((profile) => isContributorModel(profile, next.privacy.contributorPattern));
  next.privacy.allowContributor = false;
  if (contributorSelected) {
    if (classification !== "public") {
      ctx.ui.notify("Contributor endpoints remain blocked because this repository is not classified public.", "warning");
    } else {
      next.privacy.allowContributor = await ctx.ui.confirm(
        "Cascade setup · Contributor endpoint",
        "Allow public repository content to be sent to the selected Contributor endpoint?"
      );
    }
  }

  const budgetMode = await ctx.ui.select("Cascade setup · Budgets", [
    SETUP_OPTIONS.keepBudgets,
    SETUP_OPTIONS.editBudgets
  ]);
  if (!budgetMode) return { cancelled: true };
  if (budgetMode === SETUP_OPTIONS.editBudgets) {
    const calls = await choosePositiveNumber(ctx, "Maximum expert calls per session", next.budgets.maxExpertCalls);
    if (calls === undefined) return { cancelled: true };
    const expertCost = await choosePositiveNumber(ctx, "Maximum expert cost in USD", next.budgets.maxExpertCostUsd);
    if (expertCost === undefined) return { cancelled: true };
    const sessionCost = await choosePositiveNumber(ctx, "Maximum total session cost in USD", next.budgets.maxSessionEstimatedCostUsd);
    if (sessionCost === undefined) return { cancelled: true };
    next.budgets.maxExpertCalls = Math.floor(calls);
    next.budgets.maxExpertCostUsd = expertCost;
    next.budgets.maxSessionEstimatedCostUsd = sessionCost;
  }

  const confirmed = await ctx.ui.confirm("Save Cascade settings?", setupSummary(next, scope));
  if (!confirmed) return { cancelled: true };

  const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });
  const uniqueMissing = [...new Set(missingProviders)].filter(Boolean);
  let loginProvider;
  if (uniqueMissing.length) {
    const login = await ctx.ui.confirm(
      "Cascade setup · Authentication required",
      `No usable Pi credential is configured for: ${uniqueMissing.join(", ")}. Prepare Pi's native /login command now?`
    );
    if (login) loginProvider = await chooseLoginProvider(ctx, uniqueMissing[0]);
  }

  return {
    cancelled: false,
    config: next,
    scope,
    path: persisted.path,
    loginProvider,
    workerReady: next.worker.selectionMode === "native" ? Boolean(ctx.model) : profileReady(ctx, next.worker),
    expertReady: next.mode === "dual" ? profileReady(ctx, next.expert) : true
  };
}

export async function runRoleModelPicker({ ctx, config, role }) {
  if (!ctx?.hasUI) throw new Error("Cascade model selection requires Pi's interactive UI");
  if (!['worker', 'expert'].includes(role)) throw new Error("Role must be worker or expert");

  const next = deepClone(config);
  if (role === "worker") {
    const strategy = await ctx.ui.select("Cascade · Worker model", [
      SETUP_OPTIONS.workerNative,
      SETUP_OPTIONS.workerFixed
    ]);
    if (!strategy) return { cancelled: true };
    if (strategy === SETUP_OPTIONS.workerNative) {
      next.worker = {
        ...next.worker,
        selectionMode: "native",
        thinkingMode: "native",
        ...(ctx.model ? { provider: ctx.model.provider, model: modelId(ctx.model) } : {})
      };
      const scope = await chooseScope(ctx);
      if (!scope) return { cancelled: true };
      const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });
      return { cancelled: false, config: next, scope, path: persisted.path };
    }
  }

  const selected = await chooseFixedModel(ctx, role === "worker" ? "Worker" : "Expert", next[role]);
  if (!selected) return { cancelled: true };
  const thinking = await chooseThinking(ctx, role === "worker" ? "Worker" : "Expert", selected.profile);
  if (!thinking) return { cancelled: true };
  next[role] = { ...selected.profile, ...thinking };
  const scope = await chooseScope(ctx);
  if (!scope) return { cancelled: true };
  const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });
  return {
    cancelled: false,
    config: next,
    scope,
    path: persisted.path,
    loginProvider: selected.ready ? undefined : selected.provider
  };
}
