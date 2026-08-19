#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}

async function write(path, content) {
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Unable to locate ${label}`);
  return text.replace(from, to);
}

function replaceRegex(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Unable to locate ${label}`);
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

let defaults = await read("extension/core/defaults.mjs");
defaults = replaceOnce(defaults, 'export const PACKAGE_VERSION = "0.2.0";', 'export const PACKAGE_VERSION = "0.3.0";', "package version");
defaults = replaceOnce(
  defaults,
  [
    '  worker: {',
    '    provider: "meta-model-api",',
    '    model: "muse-spark-1.2-contributor",',
    '    thinking: "medium",'
  ].join("\n"),
  [
    '  worker: {',
    '    selectionMode: "native",',
    '    thinkingMode: "native",',
    '    provider: "meta-model-api",',
    '    model: "muse-spark-1.2-contributor",',
    '    thinking: "medium",',
    '    restrictTools: false,'
  ].join("\n"),
  "worker defaults"
);
defaults = replaceOnce(
  defaults,
  [
    '  expert: {',
    '    provider: "openrouter",',
    '    model: "openrouter/auto",',
    '    thinking: "high",'
  ].join("\n"),
  [
    '  expert: {',
    '    selectionMode: "configured",',
    '    thinkingMode: "configured",',
    '    provider: "openrouter",',
    '    model: "openrouter/auto",',
    '    thinking: "high",',
    '    restrictTools: false,'
  ].join("\n"),
  "expert defaults"
);
defaults = replaceOnce(
  defaults,
  'export const VALID_MODES = new Set(["single", "dual"]);',
  'export const VALID_MODES = new Set(["single", "dual"]);\nexport const VALID_SELECTION_MODES = new Set(["native", "configured"]);',
  "selection mode export"
);
await write("extension/core/defaults.mjs", defaults);

let cli = await read("bin/cascade.mjs");
cli = replaceOnce(
  cli,
  [
    '  const workerPolicy = evaluateContributorPolicy(config, config.worker);',
    '  if (!workerPolicy.allowed) throw new Error(`Worker endpoint blocked: ${workerPolicy.reason}`);'
  ].join("\n"),
  [
    '  const configuredWorker = Boolean(parsed.env.CASCADE_WORKER) || config.worker.selectionMode === "configured";',
    '  if (configuredWorker) {',
    '    const workerPolicy = evaluateContributorPolicy(config, config.worker);',
    '    if (!workerPolicy.allowed) throw new Error(`Worker endpoint blocked: ${workerPolicy.reason}`);',
    '  }'
  ].join("\n"),
  "conditional worker privacy policy"
);
cli = replaceOnce(
  cli,
  [
    '  const piArgs = [',
    '    "--extension", EXTENSION_PATH,',
    '    "--provider", config.worker.provider,',
    '    "--model", config.worker.model,',
    '    "--thinking", config.worker.thinking,',
    '    ...parsed.passthrough',
    '  ];'
  ].join("\n"),
  [
    '  const piArgs = ["--extension", EXTENSION_PATH];',
    '  if (configuredWorker) {',
    '    piArgs.push("--provider", config.worker.provider, "--model", config.worker.model);',
    '    if (config.worker.thinkingMode !== "native") piArgs.push("--thinking", config.worker.thinking);',
    '  }',
    '  piArgs.push(...parsed.passthrough);'
  ].join("\n"),
  "native Pi launcher arguments"
);
await write("bin/cascade.mjs", cli);

let extension = await read("extension/index.mjs");
extension = replaceOnce(
  extension,
  'import { modelReference, parseModelReference, shortHash, truncateText } from "./core/util.mjs";',
  [
    'import { modelReference, parseModelReference, shortHash, truncateText } from "./core/util.mjs";',
    'import { applyRoleToolPolicy, createToolPolicyState, modelId, sameModel, usesConfiguredModel } from "./core/pi-parity.mjs";',
    'import { chooseLoginProvider, prepareNativeLogin, runCascadeSetup, runRoleModelPicker } from "./core/tui-setup.mjs";'
  ].join("\n"),
  "parity and TUI imports"
);

extension = replaceOnce(
  extension,
  [
    'function activeModelConfig(ctx, config, currentRole) {',
    '  const provider = ctx.model?.provider;',
    '  const id = ctx.model?.id || ctx.model?.model || ctx.model?.modelId;',
    '  if (provider && id) return { provider, model: id };',
    '  return currentRole === "expert" ? config.expert : config.worker;',
    '}'
  ].join("\n"),
  [
    'function activeModelConfig(ctx, config, currentRole) {',
    '  const provider = ctx.model?.provider;',
    '  const id = ctx.model?.id || ctx.model?.model || ctx.model?.modelId;',
    '  if (provider && id) return { provider, model: id };',
    '  if (currentRole === "worker" && config.worker?.selectionMode !== "configured") {',
    '    return { provider: "native", model: "unselected" };',
    '  }',
    '  return currentRole === "expert" ? config.expert : config.worker;',
    '}'
  ].join("\n"),
  "native active model fallback"
);

extension = replaceOnce(
  extension,
  '  const data = isContributorModel(currentRole === "expert" ? config.expert : config.worker, config.privacy.contributorPattern)',
  '  const data = currentRole === "worker" && config.worker?.selectionMode !== "configured"\n    ? "PRIVATE"\n    : isContributorModel(currentRole === "expert" ? config.expert : config.worker, config.privacy.contributorPattern)',
  "native status privacy label"
);
extension = replaceOnce(
  extension,
  '    ? "CONTRIBUTOR"\n    : "PRIVATE";',
  '      ? "CONTRIBUTOR"\n      : "PRIVATE";',
  "status privacy ternary indentation"
);

const factoryStateAndHelpers = [
  '  let completionGateInFlight = false;',
  '  let workerRuntimeModel;',
  '  let workerRuntimeThinking;',
  '  let roleSwitchInProgress = false;',
  '  const toolPolicyState = createToolPolicyState();',
  '',
  '  function captureWorkerRuntime(ctx) {',
  '    if (!ctx?.model) return;',
  '    workerRuntimeModel = ctx.model;',
  '    workerRuntimeThinking = ctx.thinkingLevel;',
  '    config.worker = {',
  '      ...config.worker,',
  '      provider: ctx.model.provider,',
  '      model: modelId(ctx.model)',
  '    };',
  '  }',
  '',
  '  function cascadeControlTools(role) {',
  '    const controls = CONTROL_TOOLS.filter((name) => {',
  '      if (name === "cascade_expert" && config.mode !== "dual") return false;',
  '      return role === "worker" || name !== "cascade_expert";',
  '    });',
  '    if (config.workspaceRuntime?.enabled) controls.push("cascade_workspace");',
  '    return controls;',
  '  }',
  '',
  '  function applyTools(role, profile) {',
  '    return applyRoleToolPolicy({',
  '      pi,',
  '      profile,',
  '      controls: cascadeControlTools(role),',
  '      state: toolPolicyState',
  '    });',
  '  }'
].join("\n");
extension = replaceOnce(
  extension,
  '  let completionGateInFlight = false;',
  factoryStateAndHelpers,
  "extension factory parity state"
);

extension = replaceOnce(
  extension,
  '    if (workerRef?.provider && workerRef?.model) config.worker = { ...config.worker, ...workerRef };',
  [
    '    if (workerRef?.provider && workerRef?.model) {',
    '      config.worker = { ...config.worker, ...workerRef, selectionMode: "configured", thinkingMode: "configured" };',
    '    }',
    '    if (process.env.CASCADE_WORKER) config.worker.selectionMode = "configured";'
  ].join("\n"),
  "explicit worker model selection"
);
extension = replaceOnce(
  extension,
  '    if (workerTools) config.worker.tools = workerTools;',
  '    if (workerTools) config.worker = { ...config.worker, tools: workerTools, restrictTools: true };',
  "explicit worker tool restriction"
);
extension = replaceOnce(
  extension,
  '    if (expertTools) config.expert.tools = expertTools;',
  '    if (expertTools) config.expert = { ...config.expert, tools: expertTools, restrictTools: true };',
  "explicit expert tool restriction"
);

const activateRole = [
  '  async function activateRole(role, ctx, { quiet = false } = {}) {',
  '    const target = role === "expert" ? config.expert : config.worker;',
  '    if (role === "expert" && config.mode !== "dual") throw new Error("Expert role is unavailable in single-model mode");',
  '    const policyTarget = role === "worker" && !usesConfiguredModel(target)',
  '      ? activeModelConfig(ctx, config, currentRole)',
  '      : target;',
  '    const policy = policyFor(policyTarget);',
  '    if (!policy.allowed) throw new Error(policy.reason);',
  '',
  '    roleSwitchInProgress = true;',
  '    try {',
  '      if (role === "worker" && !usesConfiguredModel(target)) {',
  '        if (!workerRuntimeModel && ctx.model) captureWorkerRuntime(ctx);',
  '        if (workerRuntimeModel && !sameModel(ctx.model, workerRuntimeModel)) {',
  '          const changed = await pi.setModel(workerRuntimeModel);',
  '          if (!changed) throw new Error(`No usable credentials for ${workerRuntimeModel.provider}/${modelId(workerRuntimeModel)}`);',
  '        }',
  '        if (target.thinkingMode === "configured" && target.thinking) pi.setThinkingLevel(target.thinking);',
  '        else if (workerRuntimeThinking) pi.setThinkingLevel(workerRuntimeThinking);',
  '      } else {',
  '        const model = findConfiguredModel(ctx, target);',
  '        if (!model) throw new Error(`Configured ${role} model was not found: ${describeModel(target)}`);',
  '        const changed = await pi.setModel(model);',
  '        if (!changed) throw new Error(`No usable credentials for ${describeModel(target)}`);',
  '        if (target.thinkingMode !== "native" && target.thinking) pi.setThinkingLevel(target.thinking);',
  '      }',
  '    } finally {',
  '      roleSwitchInProgress = false;',
  '    }',
  '',
  '    applyTools(role, target);',
  '    currentRole = role;',
  '    blockedReason = "";',
  '    if (!quiet) {',
  '      const label = role === "worker" && !usesConfiguredModel(target) ? "native Pi model" : describeModel(target);',
  '      notify(ctx, `Cascade active role: ${role} (${label})`, "info");',
  '    }',
  '    updateStatus(ctx);',
  '  }',
  '',
  '  function initialize(ctx) {'
].join("\n");
extension = replaceRegex(
  extension,
  /  async function activateRole\(role, ctx, \{ quiet = false \} = \{\}\) \{[\s\S]*?\n  \}\n\n  function initialize\(ctx\) \{/,
  activateRole,
  "role activation implementation"
);

extension = replaceOnce(
  extension,
  '    activeCtx = ctx;\n    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);',
  '    activeCtx = ctx;\n    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);\n    if (config.worker.selectionMode !== "configured" && ctx.model) captureWorkerRuntime(ctx);',
  "initial native worker capture"
);
extension = replaceOnce(
  extension,
  '    const initialProfile = currentRole === "expert" ? config.expert : config.worker;',
  [
    '    const initialProfile = currentRole === "expert"',
    '      ? config.expert',
    '      : (config.worker.selectionMode === "configured"',
    '          ? config.worker',
    '          : activeModelConfig(ctx, config, currentRole));'
  ].join("\n"),
  "initial privacy profile"
);

extension = replaceOnce(
  extension,
  [
    '  pi.on("model_select", (_event, ctx) => {',
    '    activeCtx = ctx;',
    '    updateStatus(ctx);',
    '  });'
  ].join("\n"),
  [
    '  pi.on("model_select", (event, ctx) => {',
    '    activeCtx = ctx;',
    '    if (!roleSwitchInProgress) {',
    '      if (currentRole === "worker") {',
    '        workerRuntimeModel = event.model;',
    '        workerRuntimeThinking = ctx.thinkingLevel;',
    '        config.worker = { ...config.worker, provider: event.model.provider, model: modelId(event.model) };',
    '      } else if (currentRole === "expert") {',
    '        config.expert = {',
    '          ...config.expert,',
    '          selectionMode: "configured",',
    '          provider: event.model.provider,',
    '          model: modelId(event.model)',
    '        };',
    '      }',
    '    }',
    '    updateStatus(ctx);',
    '  });',
    '',
    '  pi.on("thinking_level_select", (event, ctx) => {',
    '    activeCtx = ctx;',
    '    if (!roleSwitchInProgress) {',
    '      if (currentRole === "worker") {',
    '        workerRuntimeThinking = event.level;',
    '        if (config.worker.thinkingMode === "configured") config.worker.thinking = event.level;',
    '      } else if (currentRole === "expert") {',
    '        config.expert = { ...config.expert, thinkingMode: "configured", thinking: event.level };',
    '      }',
    '    }',
    '    updateStatus(ctx);',
    '  });'
  ].join("\n"),
  "role-aware model and thinking events"
);

const setupHelpersAndCommands = [
  '  async function applySetupResult(result, ctx) {',
  '    if (!result || result.cancelled) return false;',
  '    if (result.scope === "session") config = result.config;',
  '    else loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);',
  '    validation = validateConfig(config);',
  '    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });',
  '    if (validation.errors.length) {',
  '      blockedReason = validation.errors.join("; ");',
  '      notify(ctx, `Cascade configuration errors: ${blockedReason}`, "error");',
  '      updateStatus(ctx);',
  '      return false;',
  '    }',
  '    if (config.worker.selectionMode !== "configured" && ctx.model) captureWorkerRuntime(ctx);',
  '    const role = currentRole === "expert" && config.mode === "dual" ? "expert" : "worker";',
  '    await activateRole(role, ctx, { quiet: true });',
  '    notify(ctx, result.path ? `Cascade settings saved to ${result.path}` : "Cascade settings applied to this session", "info");',
  '    if (result.loginProvider) prepareNativeLogin(ctx, result.loginProvider);',
  '    updateStatus(ctx);',
  '    return true;',
  '  }',
  '',
  '  async function openSetup(ctx) {',
  '    ensureInitialized(ctx);',
  '    return applySetupResult(await runCascadeSetup({ ctx, config }), ctx);',
  '  }',
  '',
  '  async function openRoleModelPicker(role, ctx) {',
  '    ensureInitialized(ctx);',
  '    const result = await runRoleModelPicker({ ctx, config, role });',
  '    if (!result || result.cancelled) return false;',
  '    config = result.config;',
  '    if (result.scope !== "session") loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);',
  '    if (role === "worker" && config.worker.selectionMode !== "configured" && ctx.model) captureWorkerRuntime(ctx);',
  '    if (currentRole === role || role === "worker") await activateRole(role, ctx, { quiet: true });',
  '    notify(ctx, result.path ? `${role} model saved to ${result.path}` : `${role} model changed for this session`, "info");',
  '    if (result.loginProvider) prepareNativeLogin(ctx, result.loginProvider);',
  '    updateStatus(ctx);',
  '    return true;',
  '  }',
  '',
  '  pi.registerCommand("cascade-setup", {',
  '    description: "Configure Cascade through Pi\'s native TUI",',
  '    async handler(_args, ctx) {',
  '      try { await openSetup(ctx); }',
  '      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }',
  '    }',
  '  });',
  '',
  '  pi.registerCommand("cascade-model", {',
  '    description: "Choose and optionally save the worker or expert model",',
  '    async handler(args, ctx) {',
  '      const [role = "worker"] = parseWords(args);',
  '      if (!["worker", "expert"].includes(role)) return notify(ctx, "Usage: /cascade-model worker|expert", "warning");',
  '      try { await openRoleModelPicker(role, ctx); }',
  '      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }',
  '    }',
  '  });',
  '',
  '  pi.registerCommand("cascade-auth", {',
  '    description: "Prepare Pi\'s native /login flow for a provider",',
  '    async handler(args, ctx) {',
  '      ensureInitialized(ctx);',
  '      const requested = String(args || "").trim();',
  '      const provider = requested || await chooseLoginProvider(ctx);',
  '      if (provider) prepareNativeLogin(ctx, provider);',
  '    }',
  '  });',
  '',
  '  pi.registerCommand("cascade", {'
].join("\n");
extension = replaceOnce(
  extension,
  '  pi.registerCommand("cascade", {',
  setupHelpersAndCommands,
  "TUI setup commands"
);
extension = replaceOnce(
  extension,
  '      const [action] = parseWords(args);\n      if (action === "reload") {',
  [
    '      const [action] = parseWords(args);',
    '      if (action === "setup") {',
    '        await openSetup(ctx);',
    '        return;',
    '      }',
    '      if (action === "reload") {'
  ].join("\n"),
  "/cascade setup alias"
);
await write("extension/index.mjs", extension);

const packageJson = JSON.parse(await read("package.json"));
packageJson.version = "0.3.0";
packageJson.scripts["tui:smoke"] = "node scripts/run-tui-smoke.mjs";
packageJson.scripts.ci = "npm test && npm run check && npm run brand:check && npm run legal:check && npm run smoke && npm run tui:smoke";
await write("package.json", JSON.stringify(packageJson, null, 2));

const lock = JSON.parse(await read("package-lock.json"));
lock.version = "0.3.0";
if (lock.packages?.[""]) lock.packages[""].version = "0.3.0";
await write("package-lock.json", JSON.stringify(lock, null, 2));

const upstream = JSON.parse(await read("UPSTREAM.json"));
upstream.cascadeVersion = "0.3.0";
await write("UPSTREAM.json", JSON.stringify(upstream, null, 2));

let readme = await read("README.md");
readme = readme.replaceAll("cascade 0.2.0", "cascade 0.3.0");
if (!readme.includes("## Native Pi TUI and setup")) {
  const section = [
    '## Native Pi TUI and setup',
    '',
    'Cascade preserves Pi\'s normal TUI, commands, model picker, login flow, tools, keybindings, sessions, and extensions. Cascade features are additive.',
    '',
    'Start normally:',
    '',
    '```bash',
    'cascade --approve',
    '```',
    '',
    'Inside the TUI, run `/cascade-setup`. The wizard configures single or dual mode, worker and expert models, thinking levels, automatic consultation, budgets, privacy, and session/project/global persistence.',
    '',
    'Authentication stays native to Pi. Run `/login openrouter`, or use `/cascade-auth` to place the appropriate `/login` command into the editor. Provider secrets are not written to project configuration.',
    '',
    'Pi\'s native `/model` command remains authoritative when the worker uses current-Pi-model mode. Use `/cascade-model expert` for a quick expert picker.',
    ''
  ].join("\n");
  readme = replaceOnce(readme, "## Start using it\n", `${section}\n## Start using it\n`, "README start section");
}
readme = readme.replace(
  "Both roles are fully configurable. Each can independently select provider and model ID, reasoning level, tool allowlist, role instructions, timeout and output limits, provider base URL, API adapter, headers, credential source, and cost budgets.",
  "Both roles are fully configurable through `/cascade-setup`, `/cascade-model`, project/global configuration, environment variables, or CLI flags. The worker inherits Pi's active tools by default; a tool list becomes restrictive only when `restrictTools` is explicitly enabled."
);
await write("README.md", readme);

let install = await read("INSTALL.md");
if (!install.includes("/cascade-setup")) {
  install += [
    '',
    '## Configure in the TUI',
    '',
    'Launch `cascade --approve`, then run `/cascade-setup`. Use `/login PROVIDER` for OAuth or API-key entry and Pi\'s native `/model` command for the current worker. Cascade does not store provider secrets in project configuration.',
    ''
  ].join("\n");
}
await write("INSTALL.md", install);

let configuration = await read("docs/configuration.md");
if (!configuration.includes("## Native TUI configuration")) {
  configuration = configuration.replace(
    "# Configuration reference\n",
    [
      '# Configuration reference',
      '',
      '## Native TUI configuration',
      '',
      'For normal use, run `/cascade-setup` inside the Cascade TUI. The wizard persists project or global settings and uses Pi\'s model registry. Authentication is handled by Pi\'s native `/login` command. JSON remains an advanced persistence and automation interface, not a prerequisite.',
      '',
      'The worker supports `selectionMode: "native"`, which leaves Pi\'s current model and `/model` picker authoritative. `restrictTools` defaults to `false`, so Cascade does not replace Pi\'s active tools.',
      ''
    ].join("\n")
  );
}
await write("docs/configuration.md", configuration);

let changelog = await read("CHANGELOG.md");
if (!changelog.includes("## 0.3.0")) {
  changelog = changelog.replace(
    "# Changelog\n",
    [
      '# Changelog',
      '',
      '## 0.3.0 - 2026-08-19',
      '',
      '### Added',
      '',
      '- Native TUI setup for worker, expert, mode, thinking, routing, budgets, privacy, and session/project/global persistence.',
      '- Role-aware model selection backed by Pi\'s model registry.',
      '- Native Pi authentication handoff through `/login` and `/cascade-auth`.',
      '- A real pseudo-terminal smoke test for TUI startup and setup interaction.',
      '',
      '### Fixed',
      '',
      '- Cascade no longer forces a worker model before Pi\'s TUI starts in native worker mode.',
      '- Unrestricted roles no longer replace Pi\'s active tools with a Cascade allowlist.',
      '- Pi\'s native model picker updates the active Cascade role.',
      '- Single-model mode preserves normal Pi model, tool, command, session, and TUI behavior.',
      ''
    ].join("\n")
  );
}
await write("CHANGELOG.md", changelog);

let report = await read("TEST_REPORT.md");
if (!report.includes("## Native Pi TUI parity")) {
  report += [
    '',
    '## Native Pi TUI parity',
    '',
    'The suite includes native-tool preservation, reversible explicit restrictions, TUI wizard persistence, native `/login` preparation, role-aware model selection, and a pseudo-terminal test that launches the bundled Pi TUI, invokes `/cascade-setup`, verifies the selector, cancels it, and shuts down cleanly.',
    ''
  ].join("\n");
}
await write("TEST_REPORT.md", report);

console.log("Existing Cascade sources updated for native Pi parity and TUI setup.");
