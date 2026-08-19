import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
  VALID_HARNESS_MODES,
  VALID_MODES,
  VALID_THINKING_LEVELS
} from "./defaults.mjs";
import {
  deepClone,
  deepMerge,
  normalizeStringArray,
  parseModelReference,
  readJsonFile
} from "./util.mjs";

export function getGlobalConfigPath(env = process.env) {
  if (env.PI_CASCADE_CONFIG_GLOBAL) return resolve(env.PI_CASCADE_CONFIG_GLOBAL);
  const piAgentDir = env.PI_AGENT_DIR ? resolve(env.PI_AGENT_DIR) : join(homedir(), ".pi", "agent");
  return join(piAgentDir, "cascade.json");
}

export function findProjectRoot(cwd) {
  let current = resolve(cwd);
  for (;;) {
    if (existsSync(join(current, ".pi"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

export function getProjectConfigPath(cwd, env = process.env) {
  if (env.PI_CASCADE_CONFIG_PROJECT) return resolve(env.PI_CASCADE_CONFIG_PROJECT);
  return join(findProjectRoot(cwd), ".pi", "cascade.json");
}

function parseBooleanEnvironment(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected a boolean environment value, received ${JSON.stringify(value)}`);
}

function parseNumberEnvironment(value, name) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  return parsed;
}

function parseListEnvironment(value) {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("Expected a JSON array of strings");
    }
    return parsed;
  }
  return text.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function environmentOverrides(env = process.env) {
  const result = {};
  if (env.PI_CASCADE_MODE) result.mode = env.PI_CASCADE_MODE;
  if (env.PI_CASCADE_PI_BIN) result.piBinary = env.PI_CASCADE_PI_BIN;

  const worker = parseModelReference(env.PI_CASCADE_WORKER || "");
  if (worker) result.worker = worker;
  if (env.PI_CASCADE_WORKER_THINKING) {
    result.worker = { ...(result.worker || {}), thinking: env.PI_CASCADE_WORKER_THINKING };
  }
  if (env.PI_CASCADE_WORKER_TOOLS !== undefined) {
    result.worker = { ...(result.worker || {}), tools: parseListEnvironment(env.PI_CASCADE_WORKER_TOOLS) };
  }
  if (env.PI_CASCADE_WORKER_INSTRUCTIONS !== undefined) {
    result.worker = { ...(result.worker || {}), instructions: String(env.PI_CASCADE_WORKER_INSTRUCTIONS) };
  }
  const expert = parseModelReference(env.PI_CASCADE_EXPERT || "");
  if (expert) result.expert = expert;
  if (env.PI_CASCADE_EXPERT_THINKING) {
    result.expert = { ...(result.expert || {}), thinking: env.PI_CASCADE_EXPERT_THINKING };
  }
  if (env.PI_CASCADE_EXPERT_TOOLS !== undefined) {
    result.expert = { ...(result.expert || {}), tools: parseListEnvironment(env.PI_CASCADE_EXPERT_TOOLS) };
  }
  if (env.PI_CASCADE_EXPERT_INSTRUCTIONS !== undefined) {
    result.expert = { ...(result.expert || {}), instructions: String(env.PI_CASCADE_EXPERT_INSTRUCTIONS) };
  }
  const expertTimeoutMs = parseNumberEnvironment(env.PI_CASCADE_EXPERT_TIMEOUT_MS, "PI_CASCADE_EXPERT_TIMEOUT_MS");
  if (expertTimeoutMs !== undefined) result.expert = { ...(result.expert || {}), timeoutMs: expertTimeoutMs };
  const expertMaxOutput = parseNumberEnvironment(env.PI_CASCADE_EXPERT_MAX_OUTPUT_CHARACTERS, "PI_CASCADE_EXPERT_MAX_OUTPUT_CHARACTERS");
  if (expertMaxOutput !== undefined) result.expert = { ...(result.expert || {}), maxOutputCharacters: expertMaxOutput };

  const allowContributor = parseBooleanEnvironment(env.PI_CASCADE_ALLOW_CONTRIBUTOR);
  if (allowContributor !== undefined) result.privacy = { allowContributor };
  if (env.PI_CASCADE_CLASSIFICATION) {
    result.privacy = { ...(result.privacy || {}), classification: env.PI_CASCADE_CLASSIFICATION };
  }


  const autoConsult = parseBooleanEnvironment(env.PI_CASCADE_AUTO_CONSULT);
  if (autoConsult !== undefined) result.routing = { autoConsult };
  if (env.PI_CASCADE_HARNESS_MODE) {
    result.harnessLearning = { mode: env.PI_CASCADE_HARNESS_MODE };
  }

  const budgetMappings = [
    ["PI_CASCADE_MAX_EXPERT_CALLS", "maxExpertCalls"],
    ["PI_CASCADE_MAX_EXPERT_COST_USD", "maxExpertCostUsd"],
    ["PI_CASCADE_MAX_SESSION_COST_USD", "maxSessionEstimatedCostUsd"],
    ["PI_CASCADE_MAX_EVIDENCE_CHARACTERS", "maxEvidenceCharacters"],
    ["PI_CASCADE_MAX_LEDGER_ENTRIES", "maxLedgerEntriesInHandoff"]
  ];
  for (const [environmentName, configName] of budgetMappings) {
    const value = parseNumberEnvironment(env[environmentName], environmentName);
    if (value !== undefined) result.budgets = { ...(result.budgets || {}), [configName]: value };
  }

  const workspaceEnabled = parseBooleanEnvironment(env.PI_CASCADE_WORKSPACE);
  if (workspaceEnabled !== undefined) result.workspaceRuntime = { enabled: workspaceEnabled };
  const workspaceUnsandboxed = parseBooleanEnvironment(env.PI_CASCADE_WORKSPACE_UNSANDBOXED);
  if (workspaceUnsandboxed !== undefined) {
    result.workspaceRuntime = { ...(result.workspaceRuntime || {}), allowUnsandboxed: workspaceUnsandboxed };
  }
  if (env.PI_CASCADE_WORKSPACE_PYTHON) {
    result.workspaceRuntime = { ...(result.workspaceRuntime || {}), pythonBinary: env.PI_CASCADE_WORKSPACE_PYTHON };
  }
  if (env.PI_CASCADE_WORKSPACE_SANDBOX_COMMAND !== undefined) {
    result.workspaceRuntime = {
      ...(result.workspaceRuntime || {}),
      sandboxCommand: parseListEnvironment(env.PI_CASCADE_WORKSPACE_SANDBOX_COMMAND)
    };
  }
  if (env.PI_CASCADE_WORKSPACE_STATE_PATH !== undefined) {
    result.workspaceRuntime = { ...(result.workspaceRuntime || {}), statePath: String(env.PI_CASCADE_WORKSPACE_STATE_PATH) };
  }
  for (const [environmentName, configName] of [
    ["PI_CASCADE_WORKSPACE_TIMEOUT_MS", "timeoutMs"],
    ["PI_CASCADE_WORKSPACE_MAX_CODE_CHARACTERS", "maxCodeCharacters"],
    ["PI_CASCADE_WORKSPACE_MAX_OUTPUT_CHARACTERS", "maxOutputCharacters"],
    ["PI_CASCADE_WORKSPACE_MAX_STATE_CHARACTERS", "maxStateCharacters"]
  ]) {
    const value = parseNumberEnvironment(env[environmentName], environmentName);
    if (value !== undefined) result.workspaceRuntime = { ...(result.workspaceRuntime || {}), [configName]: value };
  }
  return result;
}

function validateModelConfig(model, label, errors) {
  if (!model || typeof model !== "object") {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof model.provider !== "string" || !model.provider.trim()) errors.push(`${label}.provider is required`);
  if (typeof model.model !== "string" || !model.model.trim()) errors.push(`${label}.model is required`);
  if (model.thinking !== undefined && !VALID_THINKING_LEVELS.has(model.thinking)) {
    errors.push(`${label}.thinking must be one of ${[...VALID_THINKING_LEVELS].join(", ")}`);
  }
  if (model.tools !== undefined && !Array.isArray(model.tools)) errors.push(`${label}.tools must be an array`);
  if (Array.isArray(model.tools) && model.tools.some((tool) => typeof tool !== "string" || !tool.trim())) {
    errors.push(`${label}.tools must contain non-empty strings`);
  }
  if (model.instructions !== undefined && typeof model.instructions !== "string") errors.push(`${label}.instructions must be a string`);
  for (const field of ["timeoutMs", "maxOutputCharacters"]) {
    if (model[field] !== undefined && (!Number.isFinite(Number(model[field])) || Number(model[field]) <= 0)) {
      errors.push(`${label}.${field} must be a positive number`);
    }
  }
}

export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== "object") return { errors: ["Configuration must be an object"], warnings };
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CONFIG_SCHEMA_VERSION}`);
  }
  if (!VALID_MODES.has(config.mode)) errors.push(`mode must be one of ${[...VALID_MODES].join(", ")}`);
  validateModelConfig(config.worker, "worker", errors);
  if (config.mode === "dual") validateModelConfig(config.expert, "expert", errors);
  if (!VALID_HARNESS_MODES.has(config.harnessLearning?.mode)) {
    errors.push(`harnessLearning.mode must be one of ${[...VALID_HARNESS_MODES].join(", ")}`);
  }
  if (!config.providers || typeof config.providers !== "object") errors.push("providers must be an object");
  if (!config.routing || typeof config.routing !== "object") errors.push("routing must be an object");
  if (!config.privacy || typeof config.privacy !== "object") errors.push("privacy must be an object");
  if (!config.workspaceRuntime || typeof config.workspaceRuntime !== "object") {
    errors.push("workspaceRuntime must be an object");
  } else {
    if (typeof config.workspaceRuntime.enabled !== "boolean") errors.push("workspaceRuntime.enabled must be boolean");
    if (typeof config.workspaceRuntime.pythonBinary !== "string" || !config.workspaceRuntime.pythonBinary.trim()) {
      errors.push("workspaceRuntime.pythonBinary is required");
    }
    if (!Array.isArray(config.workspaceRuntime.sandboxCommand)) errors.push("workspaceRuntime.sandboxCommand must be an array");
    if (config.workspaceRuntime.enabled && !config.workspaceRuntime.allowUnsandboxed && config.workspaceRuntime.sandboxCommand.length === 0) {
      errors.push("workspaceRuntime.enabled requires sandboxCommand or explicit allowUnsandboxed=true");
    }
    for (const field of ["timeoutMs", "maxCodeCharacters", "maxOutputCharacters", "maxStateCharacters"]) {
      if (!Number.isFinite(Number(config.workspaceRuntime[field])) || Number(config.workspaceRuntime[field]) <= 0) {
        errors.push(`workspaceRuntime.${field} must be a positive number`);
      }
    }
  }

  const classification = config.privacy?.classification;
  if (!["public", "internal", "confidential", "regulated", "unknown"].includes(classification)) {
    errors.push("privacy.classification must be public, internal, confidential, regulated, or unknown");
  }
  if (config.mode === "dual" && config.worker.provider === config.expert.provider && config.worker.model === config.expert.model) {
    warnings.push("worker and expert resolve to the same model; dual mode provides no model-cost separation");
  }
  if (config.budgets?.maxExpertCalls < 0) errors.push("budgets.maxExpertCalls cannot be negative");
  if (config.routing?.thresholds?.recommend > config.routing?.thresholds?.consult) {
    warnings.push("routing.thresholds.recommend is above consult; recommendations will be skipped");
  }
  if (config.routing?.thresholds?.consult > config.routing?.thresholds?.takeover) {
    warnings.push("routing.thresholds.consult is above takeover; takeover can precede consultation");
  }
  return { errors, warnings };
}

export function normalizeConfig(config) {
  const normalized = deepClone(config);
  normalized.worker.tools = normalizeStringArray(normalized.worker.tools, DEFAULT_CONFIG.worker.tools);
  normalized.expert.tools = normalizeStringArray(normalized.expert.tools, DEFAULT_CONFIG.expert.tools);
  normalized.privacy.denyPaths = normalizeStringArray(normalized.privacy.denyPaths, DEFAULT_CONFIG.privacy.denyPaths);
  normalized.routing.failureCommands = normalizeStringArray(
    normalized.routing.failureCommands,
    DEFAULT_CONFIG.routing.failureCommands
  );
  normalized.verification.commands = Array.isArray(normalized.verification.commands)
    ? normalized.verification.commands.filter((item) => typeof item === "string" || (item && typeof item === "object"))
    : [];
  normalized.workspaceRuntime.sandboxCommand = normalizeStringArray(
    normalized.workspaceRuntime.sandboxCommand,
    DEFAULT_CONFIG.workspaceRuntime.sandboxCommand
  );
  normalized.workspaceRuntime.pythonBinary = String(
    normalized.workspaceRuntime.pythonBinary || DEFAULT_CONFIG.workspaceRuntime.pythonBinary
  );
  normalized.workspaceRuntime.statePath = String(normalized.workspaceRuntime.statePath || "");
  return normalized;
}

export function loadEffectiveConfig({
  cwd = process.cwd(),
  projectTrusted = false,
  explicitPath,
  env = process.env,
  throwOnError = true
} = {}) {
  let config = deepClone(DEFAULT_CONFIG);
  const sources = [{ type: "defaults", path: null }];

  const globalPath = getGlobalConfigPath(env);
  const globalConfig = readJsonFile(globalPath, { optional: true });
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
    sources.push({ type: "global", path: globalPath });
  }

  const projectPath = getProjectConfigPath(cwd, env);
  if (projectTrusted) {
    const projectConfig = readJsonFile(projectPath, { optional: true });
    if (projectConfig) {
      config = deepMerge(config, projectConfig);
      sources.push({ type: "project", path: projectPath });
    }
  }

  if (explicitPath) {
    const resolved = resolve(explicitPath);
    config = deepMerge(config, readJsonFile(resolved));
    sources.push({ type: "explicit", path: resolved });
  }

  config = deepMerge(config, environmentOverrides(env));
  sources.push({ type: "environment", path: null });
  config = normalizeConfig(config);

  const validation = validateConfig(config);
  if (throwOnError && validation.errors.length > 0) {
    throw new Error(`Invalid Pi Cascade configuration:\n- ${validation.errors.join("\n- ")}`);
  }
  return { config, validation, sources, globalPath, projectPath };
}

export function createExampleConfig() {
  return {
    schemaVersion: 1,
    mode: "dual",
    worker: {
      provider: "meta-model-api",
      model: "muse-spark-1.2-contributor",
      thinking: "medium",
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
      instructions: ""
    },
    expert: {
      provider: "openrouter",
      model: "openrouter/auto",
      thinking: "high",
      tools: ["read", "grep", "find", "ls", "bash"],
      timeoutMs: 600000,
      maxOutputCharacters: 120000,
      instructions: ""
    },
    privacy: {
      classification: "unknown",
      allowContributor: false
    },
    routing: {
      autoConsult: true
    },
    harnessLearning: {
      mode: "observe"
    },
    workspaceRuntime: {
      enabled: false,
      pythonBinary: "python3",
      sandboxCommand: [],
      allowUnsandboxed: false,
      timeoutMs: 120000,
      maxCodeCharacters: 20000,
      maxOutputCharacters: 40000,
      maxStateCharacters: 200000,
      statePath: ""
    }
  };
}
