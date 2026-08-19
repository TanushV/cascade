#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createExampleConfig, getGlobalConfigPath, getProjectConfigPath, loadEffectiveConfig, validateConfig } from "../extension/core/config.mjs";
import { runDoctor, formatDoctor } from "../extension/core/doctor.mjs";
import { DEFAULT_CONFIG, PACKAGE_VERSION } from "../extension/core/defaults.mjs";
import { runEvaluation, formatEvaluation } from "../extension/core/eval.mjs";
import { HarnessStore } from "../extension/core/harness.mjs";
import { formatHarnessReplay, runHarnessReplay } from "../extension/core/replay.mjs";
import { evaluateContributorPolicy } from "../extension/core/privacy.mjs";
import { probeModelProfile } from "../extension/core/probe.mjs";
import { runtimeSummary, spawnPi } from "../extension/core/pi-runtime.mjs";
import { atomicWriteJson } from "../extension/core/util.mjs";

const BIN_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = dirname(dirname(BIN_PATH));
const EXTENSION_PATH = join(PACKAGE_ROOT, "extension", "index.mjs");

function usage() {
  return `Pi Cascade

Usage:
  pi-cascade [cascade options] [--] [pi options and prompt]
  pi-cascade init [--global] [--force]
  pi-cascade doctor [--cascade-config FILE] [--approve]
  pi-cascade config show|path|example
  pi-cascade harness list|candidates|evaluate|replay|promote|rollback ...
  pi-cascade eval MANIFEST [--output FILE]
  pi-cascade probe worker|expert [cascade options]
  pi-cascade runtime
  pi-cascade self-test

Cascade options:
  --cascade-config FILE
  --cascade-mode single|dual
  --worker PROVIDER/MODEL
  --expert PROVIDER/MODEL
  --worker-thinking LEVEL
  --expert-thinking LEVEL
  --worker-tools TOOL1,TOOL2
  --expert-tools TOOL1,TOOL2
  --worker-instructions TEXT
  --expert-instructions TEXT
  --expert-timeout-ms NUMBER
  --expert-max-output-characters NUMBER
  --max-expert-calls NUMBER
  --max-expert-cost-usd NUMBER
  --max-session-cost-usd NUMBER
  --allow-contributor | --deny-contributor
  --classification public|internal|confidential|regulated|unknown
  --auto-consult | --no-auto-consult
  --harness-mode off|observe|propose|canary|auto-local
  --workspace | --no-workspace
  --workspace-python PATH
  --workspace-sandbox-command JSON_OR_COMMA_LIST
  --workspace-unsandboxed
  --workspace-state-path PATH
  --pi-bin PATH              Override the bundled runtime (normally unnecessary)
  --single | --dual

Examples:
  pi-cascade --approve --worker meta-model-api/muse-spark-1.2-contributor \\
    --expert openrouter/anthropic/claude-opus-5 "Fix the failing tests"

  pi-cascade --single --worker openrouter/openai/gpt-5.6-codex "Refactor this module"
`;
}

function takeValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new Error(`${flag} requires a value`);
  return argv[index + 1];
}

function parseCascadeOptions(argv) {
  const env = {};
  const passthrough = [];
  let explicitConfig;
  let index = 0;
  let stopped = false;
  while (index < argv.length) {
    const arg = argv[index];
    if (stopped) {
      passthrough.push(arg);
      index += 1;
      continue;
    }
    if (arg === "--") {
      stopped = true;
      index += 1;
      continue;
    }
    const pair = (name, envName) => {
      if (arg !== name) return false;
      const value = takeValue(argv, index, name);
      env[envName] = value;
      index += 2;
      return true;
    };
    if (pair("--cascade-config", "PI_CASCADE_CONFIG")) { explicitConfig = env.PI_CASCADE_CONFIG; continue; }
    if (pair("--cascade-mode", "PI_CASCADE_MODE")) continue;
    if (pair("--worker", "PI_CASCADE_WORKER")) continue;
    if (pair("--expert", "PI_CASCADE_EXPERT")) continue;
    if (pair("--worker-thinking", "PI_CASCADE_WORKER_THINKING")) continue;
    if (pair("--expert-thinking", "PI_CASCADE_EXPERT_THINKING")) continue;
    if (pair("--worker-tools", "PI_CASCADE_WORKER_TOOLS")) continue;
    if (pair("--expert-tools", "PI_CASCADE_EXPERT_TOOLS")) continue;
    if (pair("--worker-instructions", "PI_CASCADE_WORKER_INSTRUCTIONS")) continue;
    if (pair("--expert-instructions", "PI_CASCADE_EXPERT_INSTRUCTIONS")) continue;
    if (pair("--expert-timeout-ms", "PI_CASCADE_EXPERT_TIMEOUT_MS")) continue;
    if (pair("--expert-max-output-characters", "PI_CASCADE_EXPERT_MAX_OUTPUT_CHARACTERS")) continue;
    if (pair("--max-expert-calls", "PI_CASCADE_MAX_EXPERT_CALLS")) continue;
    if (pair("--max-expert-cost-usd", "PI_CASCADE_MAX_EXPERT_COST_USD")) continue;
    if (pair("--max-session-cost-usd", "PI_CASCADE_MAX_SESSION_COST_USD")) continue;
    if (pair("--classification", "PI_CASCADE_CLASSIFICATION")) continue;
    if (pair("--harness-mode", "PI_CASCADE_HARNESS_MODE")) continue;
    if (pair("--workspace-python", "PI_CASCADE_WORKSPACE_PYTHON")) continue;
    if (pair("--workspace-sandbox-command", "PI_CASCADE_WORKSPACE_SANDBOX_COMMAND")) continue;
    if (pair("--workspace-state-path", "PI_CASCADE_WORKSPACE_STATE_PATH")) continue;
    if (pair("--pi-bin", "PI_CASCADE_PI_BIN")) continue;
    if (arg === "--allow-contributor") { env.PI_CASCADE_ALLOW_CONTRIBUTOR = "1"; index += 1; continue; }
    if (arg === "--deny-contributor") { env.PI_CASCADE_ALLOW_CONTRIBUTOR = "0"; index += 1; continue; }
    if (arg === "--auto-consult") { env.PI_CASCADE_AUTO_CONSULT = "1"; index += 1; continue; }
    if (arg === "--no-auto-consult") { env.PI_CASCADE_AUTO_CONSULT = "0"; index += 1; continue; }
    if (arg === "--workspace") { env.PI_CASCADE_WORKSPACE = "1"; index += 1; continue; }
    if (arg === "--no-workspace") { env.PI_CASCADE_WORKSPACE = "0"; index += 1; continue; }
    if (arg === "--workspace-unsandboxed") { env.PI_CASCADE_WORKSPACE_UNSANDBOXED = "1"; index += 1; continue; }
    if (arg === "--single") { env.PI_CASCADE_MODE = "single"; index += 1; continue; }
    if (arg === "--dual") { env.PI_CASCADE_MODE = "dual"; index += 1; continue; }
    passthrough.push(arg);
    index += 1;
  }
  return { env, passthrough, explicitConfig };
}

function isProjectApproved(args) {
  return args.includes("--approve") || args.includes("-a") || ["1", "true", "yes"].includes(String(process.env.PI_CASCADE_PROJECT_TRUSTED || "").toLowerCase());
}

function effectiveConfig({ cwd, parsed, passthrough }) {
  const env = { ...process.env, ...parsed.env };
  const projectTrusted = isProjectApproved(passthrough);
  if (projectTrusted) env.PI_CASCADE_PROJECT_TRUSTED = "1";
  const loaded = loadEffectiveConfig({
    cwd,
    projectTrusted,
    explicitPath: parsed.explicitConfig,
    env,
    throwOnError: true
  });
  return { ...loaded, env, projectTrusted };
}

async function runPi(argv) {
  const parsed = parseCascadeOptions(argv);
  const cwd = process.cwd();
  const loaded = effectiveConfig({ cwd, parsed, passthrough: parsed.passthrough });
  const { config, env, projectTrusted } = loaded;
  const workerPolicy = evaluateContributorPolicy(config, config.worker);
  if (!workerPolicy.allowed) throw new Error(`Worker endpoint blocked: ${workerPolicy.reason}`);
  if (config.mode === "dual") {
    const expertPolicy = evaluateContributorPolicy(config, config.expert);
    if (!expertPolicy.allowed) throw new Error(`Expert endpoint blocked: ${expertPolicy.reason}`);
  }
  if (!existsSync(EXTENSION_PATH)) throw new Error(`Pi Cascade extension is missing: ${EXTENSION_PATH}`);

  const piArgs = [
    "--extension", EXTENSION_PATH,
    "--provider", config.worker.provider,
    "--model", config.worker.model,
    "--thinking", config.worker.thinking,
    ...parsed.passthrough
  ];
  const childEnv = {
    ...env,
    PI_CASCADE_PACKAGE_ROOT: PACKAGE_ROOT,
    PI_CASCADE_EXTENSION_PATH: EXTENSION_PATH,
    PI_CASCADE_PROJECT_TRUSTED: projectTrusted ? "1" : "0"
  };
  if (parsed.explicitConfig) childEnv.PI_CASCADE_CONFIG = resolve(parsed.explicitConfig);

  const { child } = spawnPi(config, piArgs, {
    cwd,
    env: childEnv,
    stdio: "inherit",
    windowsHide: false
  });
  const code = await new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => resolvePromise(signal ? 128 : status ?? 1));
  });
  process.exitCode = code;
}

function parseCommandFlags(args) {
  const result = { positional: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) { result.positional.push(arg); continue; }
    const key = arg.slice(2);
    if (["force", "global", "approve", "expert-reviewed", "no-isolation"].includes(key)) result[key] = true;
    else {
      result[key] = takeValue(args, i, arg);
      i += 1;
    }
  }
  return result;
}

function initCommand(args) {
  const flags = parseCommandFlags(args);
  const global = Boolean(flags.global);
  const path = global ? getGlobalConfigPath() : getProjectConfigPath(process.cwd());
  if (existsSync(path) && !flags.force) throw new Error(`Configuration already exists: ${path}. Use --force to replace it.`);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, createExampleConfig(), 0o600);
  console.log(`Created ${global ? "global" : "project"} Pi Cascade configuration: ${path}`);
  if (!global) console.log("Project configuration is loaded only when the project is trusted, for example with --approve.");
}

function loadForCommand(args) {
  const parsed = parseCascadeOptions(args);
  return effectiveConfig({ cwd: process.cwd(), parsed, passthrough: parsed.passthrough });
}

function doctorCommand(args) {
  const loaded = loadForCommand(args);
  const report = runDoctor({
    config: loaded.config,
    cwd: process.cwd(),
    packageRoot: PACKAGE_ROOT,
    validation: loaded.validation,
    sources: loaded.sources
  });
  console.log(formatDoctor(report));
  if (!report.ok) process.exitCode = 1;
}

function configCommand(args) {
  const [action = "show", ...rest] = args;
  if (action === "example") {
    console.log(JSON.stringify(createExampleConfig(), null, 2));
    return;
  }
  const loaded = loadForCommand(rest);
  if (action === "path") {
    console.log(JSON.stringify({ global: loaded.globalPath, project: loaded.projectPath, sources: loaded.sources }, null, 2));
    return;
  }
  if (action !== "show") throw new Error("Usage: pi-cascade config show|path|example");
  console.log(JSON.stringify({ config: loaded.config, validation: loaded.validation, sources: loaded.sources }, null, 2));
}

async function harnessCommand(args) {
  const flags = parseCommandFlags(args);
  const [action = "list", id, replayManifest] = flags.positional;
  const loaded = loadForCommand(flags.approve ? ["--approve"] : []);
  const harness = new HarnessStore({ cwd: process.cwd(), config: loaded.config, sessionId: "cli" });
  if (action === "list") {
    console.log(JSON.stringify({ manifest: harness.manifest(), entries: harness.listEntries() }, null, 2));
    return;
  }
  if (action === "candidates") {
    console.log(JSON.stringify(harness.listCandidates(), null, 2));
    return;
  }
  if (!id) throw new Error(`Harness action ${action} requires a candidate id`);
  if (action === "evaluate") {
    const metrics = {
      taskCount: Number(flags["task-count"] || 0),
      qualityDelta: Number(flags["quality-delta"] || 0),
      costDelta: Number(flags["cost-delta"] || 0),
      latencyDelta: Number(flags["latency-delta"] || 0),
      expertCallRateDelta: Number(flags["expert-call-rate-delta"] || 0),
      complexityDelta: Number(flags["complexity-delta"] || 0),
      deterministicChecksPassed: String(flags["checks-passed"] || "false") === "true",
      expertReviewed: String(flags["expert-reviewed"] || "false") === "true",
      notes: flags.notes || ""
    };
    console.log(JSON.stringify(harness.evaluate(id, metrics), null, 2));
    return;
  }
  if (action === "replay") {
    if (!replayManifest) throw new Error("Usage: pi-cascade harness replay CANDIDATE_ID MANIFEST [--output FILE] [--expert-reviewed] [--no-isolation]");
    const report = await runHarnessReplay({
      candidateId: id,
      manifestPath: replayManifest,
      config: loaded.config,
      cwd: process.cwd(),
      executable: BIN_PATH,
      packageRoot: PACKAGE_ROOT,
      outputPath: flags.output,
      expertReviewed: Boolean(flags["expert-reviewed"]),
      isolate: !flags["no-isolation"]
    });
    console.log(formatHarnessReplay(report));
    if (!report.admission.allowed) process.exitCode = 1;
    return;
  }
  if (action === "promote") {
    console.log(JSON.stringify(harness.promote(id, { force: Boolean(flags.force), promotedBy: "cli" }), null, 2));
    return;
  }
  if (action === "rollback") {
    console.log(JSON.stringify(harness.rollback(id, { rolledBackBy: "cli" }), null, 2));
    return;
  }
  throw new Error("Usage: pi-cascade harness list|candidates|evaluate|replay|promote|rollback");
}


async function probeCommand(args) {
  const [role = "worker", ...rest] = args;
  if (!["worker", "expert"].includes(role)) throw new Error("Usage: pi-cascade probe worker|expert [cascade options]");
  const loaded = loadForCommand(rest);
  if (role === "expert" && loaded.config.mode !== "dual") throw new Error("Expert probe requires dual mode");
  const profile = role === "expert" ? loaded.config.expert : loaded.config.worker;
  const policy = evaluateContributorPolicy(loaded.config, profile);
  if (!policy.allowed) throw new Error(`${role} endpoint blocked: ${policy.reason}`);
  const report = await probeModelProfile({
    config: loaded.config,
    profile,
    cwd: process.cwd(),
    extensionPath: EXTENSION_PATH,
    probeExtensionPath: join(PACKAGE_ROOT, "extension", "probe.mjs")
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

async function evalCommand(args) {
  const flags = parseCommandFlags(args);
  const [manifestPath] = flags.positional;
  if (!manifestPath) throw new Error("Usage: pi-cascade eval MANIFEST [--output FILE]");
  const report = await runEvaluation({
    manifestPath,
    executable: BIN_PATH,
    packageRoot: PACKAGE_ROOT,
    outputPath: flags.output
  });
  console.log(formatEvaluation(report));
  if (report.accepted !== report.taskCount) process.exitCode = 1;
}

function runtimeCommand() {
  const summary = runtimeSummary({ piBinary: "auto" });
  console.log(JSON.stringify({ cascadeVersion: PACKAGE_VERSION, runtime: summary }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

function selfTestCommand() {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  add("Cascade package", existsSync(BIN_PATH), BIN_PATH);
  add("Cascade extension", existsSync(EXTENSION_PATH), EXTENSION_PATH);
  const validation = validateConfig({ ...DEFAULT_CONFIG, ...createExampleConfig() });
  add("Example configuration", validation.errors.length === 0, validation.errors.join("; ") || "valid");
  const runtime = runtimeSummary({ piBinary: "auto" });
  add("Bundled Pi runtime", runtime.ok, runtime.ok ? `${runtime.reportedVersion || runtime.version} (${runtime.cliPath})` : runtime.error);
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  const ok = checks.every((check) => check.ok);
  console.log(ok ? "\nPi Cascade self-test passed." : "\nPi Cascade self-test failed.");
  if (!ok) process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (["-h", "--help", "help"].includes(command)) {
    console.log(usage());
    return;
  }
  if (["-v", "--version", "version"].includes(command)) {
    const runtime = runtimeSummary({ piBinary: "auto" });
    console.log(`pi-cascade ${PACKAGE_VERSION}`);
    console.log(runtime.ok ? `bundled-pi ${runtime.reportedVersion || runtime.version}` : `bundled-pi unavailable: ${runtime.error}`);
    if (!runtime.ok) process.exitCode = 1;
    return;
  }
  if (command === "runtime") return runtimeCommand();
  if (command === "self-test") return selfTestCommand();
  if (command === "init") return initCommand(argv.slice(1));
  if (command === "doctor") return doctorCommand(argv.slice(1));
  if (command === "config") return configCommand(argv.slice(1));
  if (command === "harness") return await harnessCommand(argv.slice(1));
  if (command === "eval") return await evalCommand(argv.slice(1));
  if (command === "probe") return await probeCommand(argv.slice(1));
  return await runPi(argv);
}

main().catch((error) => {
  console.error(`pi-cascade: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
