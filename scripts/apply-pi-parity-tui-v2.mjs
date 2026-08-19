#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

async function read(path) { return readFile(path, "utf8"); }

async function replaceUnique(path, search, replacement, label) {
  const source = await read(path);
  const at = source.indexOf(search);
  if (at < 0) throw new Error(`${path}: missing ${label}`);
  if (source.indexOf(search, at + search.length) >= 0) throw new Error(`${path}: non-unique ${label}`);
  await writeFile(path, source.replace(search, replacement), "utf8");
}

async function replacePattern(path, pattern, replacement, label) {
  const source = await read(path);
  if (!pattern.test(source)) throw new Error(`${path}: missing ${label}`);
  pattern.lastIndex = 0;
  await writeFile(path, source.replace(pattern, replacement), "utf8");
}

async function patchJson(path, edit) {
  const value = JSON.parse(await read(path));
  edit(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const indexPath = "extension/index.mjs";

await replaceUnique("extension/core/defaults.mjs", 'export const PACKAGE_VERSION = "0.2.0";', 'export const PACKAGE_VERSION = "0.3.0";', "version");
await replaceUnique("extension/core/defaults.mjs", '  mode: "dual",', '  mode: "single",', "default single mode");
await replaceUnique(
  "extension/core/defaults.mjs",
  '  worker: {\n    provider: "meta-model-api",',
  '  worker: {\n    useNativeModel: true,\n    restrictTools: false,\n    provider: "meta-model-api",',
  "worker parity fields"
);
await replaceUnique(
  "extension/core/defaults.mjs",
  '  expert: {\n    provider: "openrouter",',
  '  expert: {\n    useNativeModel: false,\n    restrictTools: false,\n    provider: "openrouter",',
  "expert parity fields"
);
await replaceUnique("extension/core/defaults.mjs", "    autoConsult: true,", "    autoConsult: false,", "opt-in automatic consultation");

await patchJson("package.json", (pkg) => {
  pkg.version = "0.3.0";
  pkg.scripts ||= {};
  pkg.scripts["parity:check"] = "node scripts/check-pi-parity.mjs";
  pkg.scripts["tui:smoke"] = "node scripts/tui-smoke.mjs";
  pkg.scripts.ci = "npm test && npm run check && npm run parity:check && npm run brand:check && npm run legal:check && npm run smoke";
});
await patchJson("UPSTREAM.json", (value) => { value.cascadeVersion = "0.3.0"; });

await replaceUnique(
  indexPath,
  'import { existsSync } from "node:fs";',
  'import { existsSync } from "node:fs";',
  "filesystem import"
);
await replaceUnique(
  indexPath,
  'import { runProgrammaticWorkspace } from "./core/workspace.mjs";',
  'import { runProgrammaticWorkspace } from "./core/workspace.mjs";\nimport { currentPiModel, runCascadeSetup } from "./core/tui-setup.mjs";',
  "setup import"
);

await replaceUnique(
  indexPath,
  `function describeModel(modelConfig) {
  if (!modelConfig) return "unconfigured";
  return modelReference(modelConfig) || \`${"${modelConfig.provider || \"?\"}/${modelConfig.model || \"?\"}"}\`;
}

function activeModelConfig(ctx, config, currentRole) {
  const provider = ctx.model?.provider;
  const id = ctx.model?.id || ctx.model?.model || ctx.model?.modelId;
  if (provider && id) return { provider, model: id };
  return currentRole === "expert" ? config.expert : config.worker;
}`,
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
  "native model helpers"
);

await replaceUnique(
  indexPath,
  '  let expertInFlight = false;\n  let activeCtx;',
  '  let expertInFlight = false;\n  let switchingRoleModel = false;\n  let roleProfiles = { worker: null, expert: null };\n  let activeCtx;',
  "role state"
);

await replaceUnique(
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

  function runtimeConfig() {
    return {
      ...config,
      workerRuntime: profileForRole("worker"),
      expertRuntime: profileForRole("expert")
    };
  }

  function loadConfig(cwd, projectTrusted) {`,
  "role helpers"
);

await replaceUnique(
  indexPath,
  '    if (workerRef?.provider && workerRef?.model) config.worker = { ...config.worker, ...workerRef };',
  '    if (workerRef?.provider && workerRef?.model) config.worker = { ...config.worker, ...workerRef, useNativeModel: false };',
  "worker CLI model override"
);
await replaceUnique(
  indexPath,
  '    if (expertRef?.provider && expertRef?.model) config.expert = { ...config.expert, ...expertRef };',
  '    if (expertRef?.provider && expertRef?.model) config.expert = { ...config.expert, ...expertRef, useNativeModel: false };',
  "expert CLI model override"
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

    // The parent session remains a complete Pi session. Cascade does not call
    // setActiveTools here; native Pi tool selection stays authoritative.
    roleProfiles[role] = { ...target, useNativeModel: false };
    currentRole = role;
    blockedReason = "";
    if (!quiet) notify(ctx, \`Cascade active role: \${role} (\${describeModel(target)})\`, "info");
    updateStatus(ctx);
  }

  function initialize(ctx) {`,
  "additive role activation"
);

await replaceUnique(
  indexPath,
  '    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);\n    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });',
  '    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);\n    roleProfiles = { worker: { ...config.worker }, expert: { ...config.expert } };\n    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });',
  "initialize profiles"
);
await replaceUnique(
  indexPath,
  '    const initialProfile = currentRole === "expert" ? config.expert : config.worker;\n    const initialPolicy = policyFor(initialProfile);',
  '    const initialProfile = activeModelConfig(ctx, runtimeConfig(), currentRole);\n    const initialPolicy = policyFor(initialProfile);',
  "initial active policy"
);

await replaceUnique(
  indexPath,
  '  const data = isContributorModel(currentRole === "expert" ? config.expert : config.worker, config.privacy.contributorPattern)',
  '  const data = isContributorModel(currentRole === "expert" ? (config.expertRuntime || config.expert) : (config.workerRuntime || config.worker), config.privacy.contributorPattern)',
  "runtime status privacy"
);
await replaceUnique(
  indexPath,
  '  const role = currentRole === "expert" ? config.expert : config.worker;',
  '  const role = currentRole === "expert" ? (config.expertRuntime || config.expert) : (config.workerRuntime || config.worker);',
  "runtime system profile"
);
await replaceUnique(
  indexPath,
  '      `Configured expert: ${describeModel(config.expert)}.`,',
  '      `Configured expert: ${describeModel(config.expertRuntime || config.expert)}.`,',
  "runtime expert appendix"
);
await replaceUnique(
  indexPath,
  '    ctx.ui.setStatus("cascade", formatStatus({ config, ledger, router, currentRole, blockedReason, harness }));',
  '    ctx.ui.setStatus("cascade", formatStatus({ config: runtimeConfig(), ledger, router, currentRole, blockedReason, harness }));',
  "runtime status config"
);
await replaceUnique(
  indexPath,
  '    const appendix = buildSystemAppendix({ config, router, harness, currentRole, contributorPolicy: policy });',
  '    const appendix = buildSystemAppendix({ config: runtimeConfig(), router, harness, currentRole, contributorPolicy: policy });',
  "runtime appendix config"
);

await replaceUnique(
  indexPath,
  `  pi.on("session_start", async (_event, ctx) => {
    initialize(ctx);
    if (process.env.CASCADE_CHILD === "1") return;
    if (!blockedReason) {
      try {
        await activateRole("worker", ctx, { quiet: true });
      } catch (error) {
        blockedReason = error instanceof Error ? error.message : String(error);
        notify(ctx, \`Cascade could not activate worker: \${blockedReason}\`, "error");
      }
    }
    updateStatus(ctx);
  });`,
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
  "native session start"
);

await replaceUnique(
  indexPath,
  `  pi.on("model_select", (_event, ctx) => {
    activeCtx = ctx;
    updateStatus(ctx);
  });`,
  `  pi.on("model_select", (_event, ctx) => {
    activeCtx = ctx;
    if (!switchingRoleModel) rememberRoleModel(currentRole, ctx);
    updateStatus(ctx);
  });`,
  "native model selection"
);

await replaceUnique(
  indexPath,
  `        initialize(ctx);
        await activateRole(currentRole === "expert" && config.mode === "dual" ? "expert" : "worker", ctx, { quiet: true });
        notify(ctx, "Cascade configuration reloaded", "info");`,
  `        initialize(ctx);
        const role = currentRole === "expert" && config.mode === "dual" ? "expert" : "worker";
        const profile = profileForRole(role);
        if (hasExplicitModel(profile)) await activateRole(role, ctx, { quiet: true });
        else rememberRoleModel(role, ctx);
        notify(ctx, "Cascade configuration reloaded without changing Pi's active tools", "info");`,
  "parity-safe reload"
);
await replaceUnique(
  indexPath,
  '        worker: config.worker,\n        expert: config.mode === "dual" ? config.expert : undefined,',
  '        worker: profileForRole("worker"),\n        expert: config.mode === "dual" ? profileForRole("expert") : undefined,',
  "role-aware status report"
);

await replaceUnique(
  indexPath,
  '      const [action] = parseWords(args);\n      if (action === "reload") {',
  '      const [action] = parseWords(args);\n      if (action === "setup") return openCascadeSetup(ctx);\n      if (action === "reload") {',
  "setup subcommand"
);

await replaceUnique(
  indexPath,
  '  pi.registerCommand("cascade-mode", {',
  `  async function openCascadeSetup(ctx) {
    ensureInitialized(ctx);
    const result = await runCascadeSetup({ ctx, config: runtimeConfig(), cwd: ctx.cwd });
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
      currentRole = "worker";
      if (hasExplicitModel(profileForRole("worker"))) await activateRole("worker", ctx, { quiet: true });
      else rememberRoleModel("worker", ctx);
      notify(ctx, \`Cascade setup saved for \${result.scope}. Native Pi /model, /login, and /settings remain available.\`, "info");
    }
    updateStatus(ctx);
  }

  pi.registerCommand("cascade-setup", {
    description: "Configure Cascade roles through the native Pi TUI",
    async handler(_args, ctx) {
      try { await openCascadeSetup(ctx); }
      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    }
  });

  pi.registerCommand("cascade-mode", {`,
  "TUI setup command"
);

await replaceUnique(
  indexPath,
  '    const policy = policyFor(config.expert);\n    if (!policy.allowed) throw new Error(`Expert endpoint blocked: ${policy.reason}`);',
  '    const expertProfile = profileForRole("expert");\n    const policy = policyFor(expertProfile);\n    if (!policy.allowed) throw new Error(`Expert endpoint blocked: ${policy.reason}`);',
  "runtime expert policy"
);
await replaceUnique(
  indexPath,
  '        config,\n        cwd: ctx.cwd,\n        mode,',
  '        config: { ...config, expert: expertProfile },\n        cwd: ctx.cwd,\n        mode,',
  "runtime expert config"
);

let extension = await read(indexPath);
if (extension.includes("pi.setActiveTools(")) throw new Error("Cascade still replaces native Pi tools");
if (!extension.includes('pi.registerCommand("cascade-setup"')) throw new Error("Missing /cascade-setup");
for (const native of ["model", "login", "settings"]) {
  if (extension.includes(`pi.registerCommand(\"${native}\"`) || extension.includes(`pi.registerCommand('${native}'`)) {
    throw new Error(`Cascade shadows native Pi /${native}`);
  }
}

const readme = await read("README.md");
const installMarker = "## Start using it\n";
if (!readme.includes(installMarker)) throw new Error("README start marker missing");
const tuiSection = `## Configure through the TUI

Launch Cascade normally:

\`\`\`bash
cascade --approve
\`\`\`

Inside the Pi TUI:

1. Run \`/login\` to add provider credentials using Pi's native credential UI.
2. Run \`/cascade-setup\` to choose single or dual mode, worker and expert models, thinking levels, automatic consultation, privacy, and save scope.
3. Use Pi's native \`/model\` and \`/settings\` whenever you want. Cascade observes role-specific model changes without replacing Pi's tools or commands.

Cascade defaults to single-model Pi-parity mode. Dual routing is enabled only after setup or explicit configuration.

`;
await writeFile("README.md", readme.replace(installMarker, `${tuiSection}${installMarker}`), "utf8");

const changelog = await read("CHANGELOG.md");
if (!changelog.includes("## 0.3.0")) {
  await writeFile(
    "CHANGELOG.md",
    changelog.replace("# Changelog\n", `# Changelog\n\n## 0.3.0 - 2026-08-19\n\n### Added\n\n- Added \`/cascade-setup\`, a role-aware interactive TUI for mode, worker, expert, reasoning, routing, privacy, and project/global/session persistence.\n- Added real pseudo-terminal smoke coverage for Pi settings, model, login, Cascade setup, and role switching.\n- Added CI invariants preventing Cascade from shadowing Pi commands or replacing Pi's active tools.\n\n### Changed\n\n- Cascade now defaults to single-model Pi-parity mode and inherits the current native Pi model.\n- Native Pi \`/model\`, \`/login\`, \`/settings\`, keybindings, tools, and provider UX remain authoritative.\n- Worker and expert models are remembered independently while the parent session retains the complete Pi tool set.\n- Automatic expert consultation is opt-in by default.\n\n### Fixed\n\n- Removed the unconditional \`setActiveTools\` call that made Cascade less capable than the Pi runtime it was extending.\n`),
    "utf8"
  );
}

console.log("Cascade 0.3.0 Pi-parity migration applied.");
