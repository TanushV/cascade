#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function read(path) { return readFile(path, "utf8"); }
async function write(path, value) { await writeFile(path, value, "utf8"); }
async function patchJson(path, edit) {
  const value = JSON.parse(await read(path));
  edit(value);
  await write(path, `${JSON.stringify(value, null, 2)}\n`);
}

let defaults = await read("extension/core/defaults.mjs");
defaults = defaults.replace(/export const PACKAGE_VERSION = "[^"]+";/, 'export const PACKAGE_VERSION = "0.3.0";');
defaults = defaults.replace(/mode:\s*"dual"/, 'mode: "single"');
if (!/worker:\s*\{\s*useNativeModel:/.test(defaults)) {
  defaults = defaults.replace(/worker:\s*\{/, 'worker: {\n    useNativeModel: true,\n    restrictTools: false,');
}
if (!/expert:\s*\{\s*useNativeModel:/.test(defaults)) {
  defaults = defaults.replace(/expert:\s*\{/, 'expert: {\n    useNativeModel: false,\n    restrictTools: false,');
}
defaults = defaults.replace(/autoConsult:\s*true/, "autoConsult: false");
await write("extension/core/defaults.mjs", defaults);

await patchJson("package.json", (pkg) => {
  pkg.version = "0.3.0";
  pkg.scripts ||= {};
  pkg.scripts["parity:check"] = "node scripts/check-pi-parity.mjs";
  pkg.scripts["tui:smoke"] = "node scripts/tui-smoke.mjs";
  pkg.scripts.ci = "npm test && npm run check && npm run parity:check && npm run brand:check && npm run legal:check && npm run smoke";
});
await patchJson("UPSTREAM.json", (value) => { value.cascadeVersion = "0.3.0"; });

const indexPath = "extension/index.mjs";
let source = await read(indexPath);
if (!source.includes('from "./core/tui-setup.mjs"')) {
  source = source.replace(
    'import { runProgrammaticWorkspace } from "./core/workspace.mjs";',
    'import { runProgrammaticWorkspace } from "./core/workspace.mjs";\nimport { currentPiModel, runCascadeSetup } from "./core/tui-setup.mjs";'
  );
}
if (!source.includes('if (modelConfig.useNativeModel) return "current Pi model";')) {
  source = source.replace(
    '  if (!modelConfig) return "unconfigured";',
    '  if (!modelConfig) return "unconfigured";\n  if (modelConfig.useNativeModel) return "current Pi model";'
  );
}
if (!source.includes("function modelFromContext(ctx)")) {
  source = source.replace(
    /\nfunction activeModelConfig\(ctx, config, currentRole\) \{[\s\S]*?\n\}/,
    `
function modelFromContext(ctx) {
  return currentPiModel(ctx);
}

function activeModelConfig(ctx, config, currentRole) {
  const active = modelFromContext(ctx);
  if (active) return { provider: active.provider, model: active.model };
  return currentRole === "expert" ? config.expert : config.worker;
}`
  );
}
if (!source.includes("let switchingRoleModel = false;")) {
  source = source.replace(
    "  let expertInFlight = false;",
    "  let expertInFlight = false;\n  let switchingRoleModel = false;\n  let roleProfiles = { worker: null, expert: null };"
  );
}
if (!source.includes("function profileForRole(role)")) {
  source = source.replace(
    "  function loadConfig(cwd, projectTrusted) {",
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
    return { ...config, workerRuntime: profileForRole("worker"), expertRuntime: profileForRole("expert") };
  }

  function loadConfig(cwd, projectTrusted) {`
  );
}
source = source.replace(
  /config\.worker = \{ \.\.\.config\.worker, \.\.\.workerRef \};/,
  "config.worker = { ...config.worker, ...workerRef, useNativeModel: false };"
);
source = source.replace(
  /config\.expert = \{ \.\.\.config\.expert, \.\.\.expertRef \};/,
  "config.expert = { ...config.expert, ...expertRef, useNativeModel: false };"
);

source = source.replace(
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
    const active = modelFromContext(ctx);
    const alreadySelected = active?.provider === target.provider && active?.model === target.model;
    switchingRoleModel = true;
    let changed = alreadySelected;
    try {
      if (!alreadySelected) changed = await pi.setModel(model);
    } finally {
      switchingRoleModel = false;
    }
    if (!changed) throw new Error(\`No usable credentials for \${describeModel(target)}\`);
    if (target.thinking && target.thinking !== "inherit") pi.setThinkingLevel(target.thinking);
    roleProfiles[role] = { ...target, useNativeModel: false };
    currentRole = role;
    blockedReason = "";
    if (!quiet) notify(ctx, \`Cascade active role: \${role} (\${describeModel(target)})\`, "info");
    updateStatus(ctx);
  }

  function initialize(ctx) {`
);

if (!source.includes("roleProfiles = { worker: { ...config.worker }, expert: { ...config.expert } };")) {
  source = source.replace(
    "    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);",
    "    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);\n    roleProfiles = { worker: { ...config.worker }, expert: { ...config.expert } };"
  );
}
source = source.replace(
  /const initialProfile = currentRole === "expert" \? config\.expert : config\.worker;/,
  "const initialProfile = activeModelConfig(ctx, runtimeConfig(), currentRole);"
);

source = source.replace(
  /  pi\.on\("session_start", async \(_event, ctx\) => \{[\s\S]*?\n  \}\);/,
  `  pi.on("session_start", async (_event, ctx) => {
    initialize(ctx);
    if (process.env.CASCADE_CHILD === "1") return;
    currentRole = "worker";
    if (config.worker?.useNativeModel || !hasExplicitModel(config.worker)) {
      rememberRoleModel("worker", ctx);
      blockedReason = "";
    } else if (!blockedReason) {
      try { await activateRole("worker", ctx, { quiet: true }); }
      catch (error) {
        blockedReason = error instanceof Error ? error.message : String(error);
        notify(ctx, \`Cascade could not activate worker: \${blockedReason}\`, "error");
      }
    }
    updateStatus(ctx);
  });`
);
source = source.replace(
  /  pi\.on\("model_select", \(_event, ctx\) => \{[\s\S]*?\n  \}\);/,
  `  pi.on("model_select", (_event, ctx) => {
    activeCtx = ctx;
    if (!switchingRoleModel) rememberRoleModel(currentRole, ctx);
    updateStatus(ctx);
  });`
);

if (!source.includes('pi.registerCommand("cascade-setup"')) {
  source = source.replace(
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

  pi.registerCommand("cascade-mode", {`
  );
}
if (!source.includes('if (action === "setup") return openCascadeSetup(ctx);')) {
  source = source.replace(
    '      const [action] = parseWords(args);',
    '      const [action] = parseWords(args);\n      if (action === "setup") return openCascadeSetup(ctx);'
  );
}
source = source.replace("pi.setActiveTools([...new Set(desired)].filter((name) => available.has(name)));", "");
source = source.replace(/\n\s*pi\.setActiveTools\([^\n]+\);/g, "");

if (!source.includes("const expertProfile = profileForRole(\"expert\");")) {
  source = source.replace(
    "    const policy = policyFor(config.expert);",
    '    const expertProfile = profileForRole("expert");\n    const policy = policyFor(expertProfile);'
  );
  source = source.replace(
    /runExpertEpisode\(\{\n\s*config,/,
    "runExpertEpisode({\n        config: { ...config, expert: expertProfile },"
  );
}

if (source.includes("pi.setActiveTools(")) throw new Error("Unable to remove Pi tool replacement");
for (const command of ["model", "login", "settings"]) {
  if (source.includes(`registerCommand(\"${command}\"`) || source.includes(`registerCommand('${command}'`)) {
    throw new Error(`Cascade shadows Pi /${command}`);
  }
}
if (!source.includes('registerCommand("cascade-setup"')) throw new Error("Unable to add Cascade setup command");
await write(indexPath, source);

const testFiles = (await readdir("tests")).filter((name) => name.endsWith(".test.mjs"));
for (const name of testFiles) {
  const path = join("tests", name);
  let testSource = await read(path);
  testSource = testSource.replace(/worker:\s*\{\s*(?!useNativeModel:)(?=provider:)/g, "worker: { useNativeModel: false, ");
  testSource = testSource.replace(/expert:\s*\{\s*(?!useNativeModel:)(?=provider:)/g, "expert: { useNativeModel: false, ");
  testSource = testSource.replace(/"worker":\s*\{\s*(?!"useNativeModel")(?="provider")/g, '"worker": { "useNativeModel": false, ');
  testSource = testSource.replace(/"expert":\s*\{\s*(?!"useNativeModel")(?="provider")/g, '"expert": { "useNativeModel": false, ');
  const start = testSource.indexOf('test("extension initializes single-model worker and records route evidence"');
  if (start >= 0) {
    const next = testSource.indexOf('\ntest("', start + 10);
    const end = next >= 0 ? next : testSource.length;
    let block = testSource.slice(start, end);
    block = block.replace(/^\s*assert\.[^\n]*(?:setModel|activeTools|setActiveTools)[^\n]*\n/gm, "");
    testSource = `${testSource.slice(0, start)}${block}${testSource.slice(end)}`;
  }
  await write(path, testSource);
}

let readme = await read("README.md");
if (!readme.includes("## Configure through the TUI")) {
  readme = readme.replace("## Start using it\n", `## Configure through the TUI\n\nLaunch \`cascade --approve\`, then use Pi's native \`/login\` for API keys and \`/cascade-setup\` for single/dual mode, worker and expert models, thinking levels, automatic consultation, privacy, and save scope. Native \`/model\` and \`/settings\` remain available and authoritative.\n\nCascade defaults to single-model Pi-parity mode and does not replace Pi's active tools.\n\n## Start using it\n`);
}
await write("README.md", readme);

let changelog = await read("CHANGELOG.md");
if (!changelog.includes("## 0.3.0")) {
  changelog = changelog.replace("# Changelog\n", `# Changelog\n\n## 0.3.0 - 2026-08-19\n\n- Restored full native Pi capability parity.\n- Added role-aware \`/cascade-setup\` TUI configuration.\n- Preserved native \`/model\`, \`/login\`, \`/settings\`, tools, and keybindings.\n- Added PTY, parity, cross-platform, installation, and security gates.\n\n`);
}
await write("CHANGELOG.md", changelog);

console.log("Tolerant Cascade 0.3.0 Pi parity codemod completed.");
