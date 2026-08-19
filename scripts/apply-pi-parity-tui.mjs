#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

async function text(path) {
  return readFile(path, "utf8");
}

async function replaceOnce(path, search, replacement, label = String(search).slice(0, 80)) {
  const source = await text(path);
  if (!source.includes(search)) throw new Error(`${path}: missing replacement target: ${label}`);
  const first = source.indexOf(search);
  if (source.indexOf(search, first + search.length) !== -1) throw new Error(`${path}: replacement target is not unique: ${label}`);
  await writeFile(path, source.replace(search, replacement), "utf8");
}

async function replacePattern(path, pattern, replacement, label) {
  const source = await text(path);
  const matches = source.match(pattern);
  if (!matches) throw new Error(`${path}: missing pattern: ${label}`);
  await writeFile(path, source.replace(pattern, replacement), "utf8");
}

async function patchJson(path, edit) {
  const value = JSON.parse(await text(path));
  edit(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const indexPath = "extension/index.mjs";

await replaceOnce(
  "extension/core/defaults.mjs",
  'export const PACKAGE_VERSION = "0.2.0";',
  'export const PACKAGE_VERSION = "0.3.0";',
  "package version"
);
await replaceOnce("extension/core/defaults.mjs", '  mode: "dual",', '  mode: "single",', "default mode");
await replaceOnce(
  "extension/core/defaults.mjs",
  '  worker: {\n    provider: "meta-model-api",',
  '  worker: {\n    useNativeModel: true,\n    restrictTools: false,\n    provider: "meta-model-api",',
  "worker native-model fields"
);
await replaceOnce(
  "extension/core/defaults.mjs",
  '  expert: {\n    provider: "openrouter",',
  '  expert: {\n    useNativeModel: false,\n    restrictTools: false,\n    provider: "openrouter",',
  "expert native-model fields"
);
await replaceOnce("extension/core/defaults.mjs", "    autoConsult: true,", "    autoConsult: false,", "default auto consultation");

await patchJson("package.json", (pkg) => {
  pkg.version = "0.3.0";
  pkg.scripts ||= {};
  pkg.scripts["parity:check"] = "node scripts/check-pi-parity.mjs";
  pkg.scripts["tui:smoke"] = "node scripts/tui-smoke.mjs";
  pkg.scripts.ci = "npm test && npm run check && npm run parity:check && npm run brand:check && npm run legal:check && npm run smoke";
});
await patchJson("UPSTREAM.json", (value) => { value.cascadeVersion = "0.3.0"; });

await replaceOnce(
  indexPath,
  'import { runProgrammaticWorkspace } from "./core/workspace.mjs";',
  'import { runProgrammaticWorkspace } from "./core/workspace.mjs";\nimport { currentPiModel, runCascadeSetup } from "./core/tui-setup.mjs";',
  "TUI setup import"
);

await replaceOnce(
  indexPath,
  'function describeModel(modelConfig) {\n  if (!modelConfig) return "unconfigured";\n  return modelReference(modelConfig) || `${modelConfig.provider || "?"}/${modelConfig.model || "?"}`;\n}\n\nfunction activeModelConfig(ctx, config, currentRole) {\n  const provider = ctx.model?.provider;\n  const id = ctx.model?.id || ctx.model?.model || ctx.model?.modelId;\n  if (provider && id) return { provider, model: id };\n  return currentRole === "expert" ? config.expert : config.worker;\n}',
  `function describeModel(modelConfig) {
  if (!modelConfig) return "unconfigured";
  if (modelConfig.useNativeModel) return "current Pi model";
  return modelReference(modelConfig) || \`${"${modelConfig.provider || \"?\"}/${modelConfig.model || \"?\"}"}\`;
}

function modelFromContext(ctx) {
  return currentPiModel(ctx);
}

function activeModelConfig(ctx, config, currentRole) {
  const active = modelFromContext(ctx);
  if (active) return { provider: active.provider, model: active.model };
  return currentRole === "expert" ? config.expert : config.worker;
}`,
  "model description helpers"
);

await replaceOnce(
  indexPath,
  '  let expertInFlight = false;\n  let activeCtx;',
  '  let expertInFlight = false;\n  let switchingRoleModel = false;\n  let roleProfiles = { worker: null, expert: null };\n  let activeCtx;',
  "role profile state"
);

await replaceOnce(
  indexPath,
  '  function loadConfig(cwd, projectTrusted) {',
  `  function profileForRole(role) {
    return roleProfiles[role] || (role === "expert" ? config.expert : config.worker);
  }

  function hasExplicitModel(profile) {
    return Boolean(profile?.provider && profile?.model && !profile.useNativeModel);
  }

  function rememberRoleModel(role, ctx) {
    const active = modelFromContext(ctx);
    if (!active) return;
    roleProfiles[role] = {
      ...(profileForRole(role) || {}),
      provider: active.provider,
      model: active.model,
      useNativeModel: false
    };
  }

  function loadConfig(cwd, projectTrusted) {`,
  "role profile helpers"
);

await replacePattern(
  indexPath,
  /  async function activateRole\(role, ctx, \{ quiet = false \} = \{\}\) \{[\s\S]*?\n  \}\n\n  function initialize\(ctx\) \{/,
  `  async function activateRole(role, ctx, { quiet = false } = {}) {
    const target = profileForRole(role);
    if (role === "expert" && config.mode !== "dual") throw new Error("Expert role is unavailable in single-model mode");

    if (currentRole !== role) rememberRoleModel(currentRole, ctx);
    if (target?.useNativeModel || !hasExplicitModel(target)) {
      currentRole = role;
      rememberRoleModel(role, ctx);
      blockedReason = "";
      if (!quiet) notify(ctx, \`Cascade active role: \${role} (current Pi model)\`, "info");
      updateStatus(ctx);
      return;
    }

    const policy = policyFor(target);
    if (!policy.allowed) throw new Error(policy.reason);
    const model = findConfiguredModel(ctx, target);
    if (!model) throw new Error(\`Configured \${role} model was not found: \${describeModel(target)}\`);
    switchingRoleModel = true;
    let changed;
    try {
      changed = await pi.setModel(model);
    } finally {
      switchingRoleModel = false;
    }
    if (!changed) throw new Error(\`No usable credentials for \${describeModel(target)}\`);
    if (target.thinking && target.thinking !== "inherit") pi.setThinkingLevel(target.thinking);

    // Pi owns the parent session's tool set. Cascade never replaces it merely
    // because a role or model changed. Bounded expert subprocesses still honor
    // their independently configured tool allowlist.
    roleProfiles[role] = { ...target, useNativeModel: false };
    currentRole = role;
    blockedReason = "";
    if (!quiet) notify(ctx, \`Cascade active role: \${role} (\${describeModel(target)})\`, "info");
    updateStatus(ctx);
  }

  function initialize(ctx) {`,
  "role activation"
);

await replaceOnce(
  indexPath,
  '    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);\n    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });',
  '    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);\n    roleProfiles = { worker: { ...config.worker }, expert: { ...config.expert } };\n    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });',
  "initialize role profiles"
);
await replaceOnce(
  indexPath,
  '    const initialProfile = currentRole === "expert" ? config.expert : config.worker;\n    const initialPolicy = policyFor(initialProfile);',
  '    const initialProfile = activeModelConfig(ctx, config, currentRole);\n    const initialPolicy = policyFor(initialProfile);',
  "initial privacy profile"
);

await replaceOnce(
  indexPath,
  '  const role = currentRole === "expert" ? config.expert : config.worker;',
  '  const role = currentRole === "expert" ? (config.expertRuntime || config.expert) : (config.workerRuntime || config.worker);',
  "system appendix profile"
);

await replaceOnce(
  indexPath,
  '  pi.on("session_start", async (_event, ctx) => {\n    initialize(ctx);\n    if (process.env.CASCADE_CHILD === "1") return;\n    if (!blockedReason) {\n      try {\n        await activateRole("worker", ctx, { quiet: true });\n      } catch (error) {\n        blockedReason = error instanceof Error ? error.message : String(error);\n        notify(ctx, `Cascade could not activate worker: ${blockedReason}`, "error");\n      }\n    }\n    updateStatus(ctx);\n  });',
  `  pi.on("session_start", async (_event, ctx) => {
    initialize(ctx);
    if (process.env.CASCADE_CHILD === "1") return;
    currentRole = "worker";
    if (config.worker?.useNativeModel || !hasExplicitModel(config.worker)) {
      rememberRoleModel("worker", ctx);
      blockedReason = "";
    } else if (!blockedReason) {
      try {
        await activateRole("worker", ctx, { quiet: true });
      } catch (error) {
        blockedReason = error instanceof Error ? error.message : String(error);
        notify(ctx, \`Cascade could not activate worker: \${blockedReason}\`, "error");
      }
    }
    updateStatus(ctx);
  });`,
  "session start parity"
);

await replaceOnce(
  indexPath,
  '  pi.on("model_select", (_event, ctx) => {\n    activeCtx = ctx;\n    updateStatus(ctx);\n  });',
  `  pi.on("model_select", (_event, ctx) => {
    activeCtx = ctx;
    if (!switchingRoleModel) rememberRoleModel(currentRole, ctx);
    updateStatus(ctx);
  });`,
  "native model selection memory"
);

await replaceOnce(
  indexPath,
  '        initialize(ctx);\n        await activateRole(currentRole === "expert" && config.mode === "dual" ? "expert" : "worker", ctx, { quiet: true });\n        notify(ctx, "Cascade configuration reloaded", "info");',
  `        initialize(ctx);
        const role = currentRole === "expert" && config.mode === "dual" ? "expert" : "worker";
        const profile = profileForRole(role);
        if (hasExplicitModel(profile)) await activateRole(role, ctx, { quiet: true });
        else rememberRoleModel(role, ctx);
        notify(ctx, "Cascade configuration reloaded without changing Pi's active tools", "info");`,
  "reload parity"
);

await replaceOnce(
  indexPath,
  '        worker: config.worker,\n        expert: config.mode === "dual" ? config.expert : undefined,',
  '        worker: profileForRole("worker"),\n        expert: config.mode === "dual" ? profileForRole("expert") : undefined,',
  "status runtime profiles"
);

await replaceOnce(
  indexPath,
  '      if (![\'worker\', \'expert\'].includes(role)) return notify(ctx, "Usage: /cascade-role worker|expert", "warning");\n      try { await activateRole(role, ctx); }',
  '      if (![\'worker\', \'expert\'].includes(role)) return notify(ctx, "Usage: /cascade-role worker|expert", "warning");\n      try { await activateRole(role, ctx); }',
  "role command presence"
);

await replaceOnce(
  indexPath,
  '  pi.registerCommand("cascade-mode", {',
  `  async function openCascadeSetup(ctx) {
    ensureInitialized(ctx);
    const setupConfig = {
      ...config,
      worker: profileForRole("worker"),
      expert: profileForRole("expert")
    };
    const result = await runCascadeSetup({ ctx, config: setupConfig, cwd: ctx.cwd });
    if (result.cancelled) return;
    config = result.config;
    roleProfiles = { worker: { ...config.worker }, expert: { ...config.expert } };
    validation = validateConfig(config);
    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });
    if (validation.errors.length) {
      blockedReason = validation.errors.join("; ");
      notify(ctx, \`Cascade setup saved with configuration errors: \${blockedReason}\`, "error");
    } else {
      blockedReason = "";
      if (hasExplicitModel(profileForRole("worker"))) await activateRole("worker", ctx, { quiet: true });
      else rememberRoleModel("worker", ctx);
      notify(ctx, \`Cascade setup saved for \${result.scope}. Pi /model, /login, and /settings remain available.\`, "info");
    }
    updateStatus(ctx);
  }

  pi.registerCommand("cascade-setup", {
    description: "Configure Cascade roles through the Pi TUI",
    async handler(_args, ctx) {
      try { await openCascadeSetup(ctx); }
      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    }
  });

  pi.registerCommand("cascade-mode", {`,
  "setup command"
);

await replaceOnce(
  indexPath,
  '      const [action] = parseWords(args);\n      if (action === "reload") {',
  '      const [action] = parseWords(args);\n      if (action === "setup") return openCascadeSetup(ctx);\n      if (action === "reload") {',
  "cascade setup subcommand"
);

await replaceOnce(
  indexPath,
  '    const target = activeModelConfig(ctx, config, currentRole);',
  '    const target = activeModelConfig(ctx, { ...config, worker: profileForRole("worker"), expert: profileForRole("expert") }, currentRole);',
  "active model policy"
);

await replaceOnce(
  indexPath,
  '    const policy = policyFor(config.expert);\n    if (!policy.allowed) throw new Error(`Expert endpoint blocked: ${policy.reason}`);',
  '    const expertProfile = profileForRole("expert");\n    const policy = policyFor(expertProfile);\n    if (!policy.allowed) throw new Error(`Expert endpoint blocked: ${policy.reason}`);',
  "expert runtime policy"
);
await replaceOnce(
  indexPath,
  '        config,\n        cwd: ctx.cwd,\n        mode,',
  '        config: { ...config, expert: expertProfile },\n        cwd: ctx.cwd,\n        mode,',
  "expert runtime profile"
);

const source = await text(indexPath);
if (source.includes("pi.setActiveTools(")) {
  throw new Error("extension/index.mjs still replaces Pi active tools");
}
if (!source.includes('pi.registerCommand("cascade-setup"')) throw new Error("Cascade setup command was not installed");
if (source.includes('pi.registerCommand("model"') || source.includes('pi.registerCommand("login"') || source.includes('pi.registerCommand("settings"')) {
  throw new Error("Cascade must not override native Pi commands");
}

console.log("Pi parity and Cascade TUI migration applied.");
