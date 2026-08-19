import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return clone(overlay);
  const result = base && typeof base === "object" && !Array.isArray(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (value && typeof value === "object" && !Array.isArray(value)) result[key] = mergeDeep(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}

function normalizeModel(model) {
  if (!model || typeof model !== "object") return undefined;
  const provider = String(model.provider || model.providerId || "").trim();
  const id = String(model.id || model.model || model.modelId || "").trim();
  if (!provider || !id) return undefined;
  return {
    provider,
    model: id,
    name: String(model.name || model.displayName || `${provider}/${id}`),
    reasoning: model.reasoning !== false
  };
}

function flattenModels(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.models)) return value.models;
  return Object.values(value).flatMap((entry) => Array.isArray(entry) ? entry : entry?.models || []);
}

export function currentPiModel(ctx) {
  return normalizeModel(ctx?.model);
}

export function collectSelectableModels(ctx) {
  const registry = ctx?.modelRegistry;
  const candidates = [];
  for (const method of ["getAvailable", "getAll", "getModels"]) {
    if (typeof registry?.[method] !== "function") continue;
    try {
      candidates.push(...flattenModels(registry[method]()));
    } catch {
      // A provider registry may reject enumeration until credentials exist.
    }
  }
  if (ctx?.model) candidates.unshift(ctx.model);
  const unique = new Map();
  for (const candidate of candidates) {
    const normalized = normalizeModel(candidate);
    if (!normalized) continue;
    unique.set(`${normalized.provider}/${normalized.model}`, normalized);
  }
  return [...unique.values()].sort((left, right) => {
    const a = `${left.provider}/${left.model}`;
    const b = `${right.provider}/${right.model}`;
    return a.localeCompare(b);
  });
}

function profileLabel(profile) {
  if (!profile?.provider || !profile?.model) return "not configured";
  return `${profile.provider}/${profile.model}`;
}

async function choose(ui, title, options) {
  const value = await ui.select(title, options);
  return value === undefined || value === null ? undefined : value;
}

async function confirm(ui, title, message) {
  if (typeof ui.confirm === "function") return Boolean(await ui.confirm(title, message));
  return (await choose(ui, title, ["Save", "Cancel"])) === "Save";
}

async function chooseRoleModel({ ctx, role, profile }) {
  const models = collectSelectableModels(ctx);
  const current = currentPiModel(ctx);
  const choices = [];
  const values = new Map();
  if (current) {
    const label = `Use current Pi model · ${current.provider}/${current.model}`;
    choices.push(label);
    values.set(label, current);
  }
  if (profile?.provider && profile?.model) {
    const label = `Keep configured ${role} · ${profile.provider}/${profile.model}`;
    if (!values.has(label)) choices.push(label);
    values.set(label, normalizeModel(profile));
  }
  for (const model of models) {
    const label = `${model.name} · ${model.provider}/${model.model}`;
    if (!values.has(label)) choices.push(label);
    values.set(label, model);
  }
  choices.push("Configure credentials first with Pi /login");
  const selected = await choose(ctx.ui, `Cascade setup · ${role} model`, choices);
  if (!selected) return { cancelled: true };
  if (selected === "Configure credentials first with Pi /login") {
    ctx.ui.notify("Run /login in Pi, add the provider credential, then run /cascade-setup again.", "info");
    return { cancelled: true, needsLogin: true };
  }
  const model = values.get(selected);
  if (!model) return { cancelled: true };
  return {
    profile: {
      ...clone(profile || {}),
      provider: model.provider,
      model: model.model,
      useNativeModel: false
    }
  };
}

async function chooseThinking(ui, role, current = "medium") {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const options = [`Keep ${current}`, ...levels.filter((level) => level !== current)];
  const selected = await choose(ui, `Cascade setup · ${role} thinking`, options);
  if (!selected) return undefined;
  return selected.startsWith("Keep ") ? current : selected;
}

function projectPath(cwd) {
  return join(cwd, ".cascade", "config.json");
}

function globalPath() {
  const root = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "cascade", "config.json");
}

function readExisting(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function writeSetupConfig(path, patch) {
  const next = mergeDeep(readExisting(path), patch);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return next;
}

export async function runCascadeSetup({ ctx, config, cwd = ctx.cwd }) {
  if (!ctx?.ui?.select) throw new Error("Cascade setup requires Pi interactive mode");
  const scopeChoice = await choose(ctx.ui, "Cascade setup · save scope", [
    "Project · .cascade/config.json",
    "Global · ~/.config/cascade/config.json",
    "Session only"
  ]);
  if (!scopeChoice) return { cancelled: true };

  const modeChoice = await choose(ctx.ui, "Cascade setup · mode", [
    config.mode === "dual" ? "Dual · current" : "Single · current",
    config.mode === "dual" ? "Single" : "Dual"
  ]);
  if (!modeChoice) return { cancelled: true };
  const mode = modeChoice.toLowerCase().startsWith("dual") ? "dual" : "single";

  const workerResult = await chooseRoleModel({ ctx, role: "worker", profile: config.worker });
  if (workerResult.cancelled) return workerResult;
  const worker = workerResult.profile;
  worker.thinking = await chooseThinking(ctx.ui, "worker", worker.thinking || "medium");
  if (!worker.thinking) return { cancelled: true };

  let expert = clone(config.expert || {});
  if (mode === "dual") {
    const expertResult = await chooseRoleModel({ ctx, role: "expert", profile: expert });
    if (expertResult.cancelled) return expertResult;
    expert = expertResult.profile;
    expert.thinking = await chooseThinking(ctx.ui, "expert", expert.thinking || "high");
    if (!expert.thinking) return { cancelled: true };
  }

  const autoChoice = await choose(ctx.ui, "Cascade setup · automatic expert consultation", [
    config.routing?.autoConsult ? "Enabled · current" : "Disabled · current",
    config.routing?.autoConsult ? "Disabled" : "Enabled"
  ]);
  if (!autoChoice) return { cancelled: true };
  const autoConsult = autoChoice.toLowerCase().startsWith("enabled");

  const classifications = ["unknown", "public", "internal", "confidential", "regulated"];
  const currentClassification = config.privacy?.classification || "unknown";
  const classificationChoice = await choose(ctx.ui, "Cascade setup · repository privacy", [
    `${currentClassification} · current`,
    ...classifications.filter((value) => value !== currentClassification)
  ]);
  if (!classificationChoice) return { cancelled: true };
  const classification = classificationChoice.split(" · ")[0];

  const contributorPattern = String(config.privacy?.contributorPattern || "contributor").toLowerCase();
  const usesContributor = [worker, expert]
    .some((profile) => `${profile?.provider || ""}/${profile?.model || ""}`.toLowerCase().includes(contributorPattern));
  let allowContributor = Boolean(config.privacy?.allowContributor);
  if (usesContributor) {
    if (classification !== "public") allowContributor = false;
    else allowContributor = await confirm(
      ctx.ui,
      "Cascade setup · Contributor endpoint",
      "Permit Contributor-model traffic for this public repository? Provider data terms still apply."
    );
  }

  const patch = {
    schemaVersion: config.schemaVersion || 1,
    mode,
    worker,
    expert,
    routing: { ...(config.routing || {}), autoConsult },
    privacy: { ...(config.privacy || {}), classification, allowContributor }
  };
  const nextConfig = mergeDeep(config, patch);
  const summary = [
    `Mode: ${mode}`,
    `Worker: ${profileLabel(worker)}`,
    mode === "dual" ? `Expert: ${profileLabel(expert)}` : "Expert: disabled",
    `Auto consult: ${autoConsult ? "on" : "off"}`,
    `Privacy: ${classification}`,
    scopeChoice
  ].join("\n");
  if (!(await confirm(ctx.ui, "Save Cascade setup", summary))) return { cancelled: true };

  let path;
  if (scopeChoice.startsWith("Project")) path = projectPath(cwd);
  else if (scopeChoice.startsWith("Global")) path = globalPath();
  if (path) writeSetupConfig(path, patch);

  return {
    cancelled: false,
    config: nextConfig,
    patch,
    scope: path ? (scopeChoice.startsWith("Project") ? "project" : "global") : "session",
    path,
    summary
  };
}
