import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_RUNTIME_PACKAGE = "@earendil-works/pi-coding-agent";
export const PINNED_PI_RUNTIME_VERSION = "0.84.2";

const NODE_SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

/**
 * Return a cross-platform child-process command. Unix can execute shebang-
 * marked JavaScript files directly; Windows cannot. Always route JavaScript
 * entrypoints through the current Node executable while leaving native
 * binaries and command names untouched.
 */
export function normalizeExecutableLaunch(command, args = []) {
  const value = String(command);
  if (NODE_SCRIPT_EXTENSIONS.has(extname(value).toLowerCase())) {
    return { command: process.execPath, args: [value, ...args] };
  }
  return { command: value, args: [...args] };
}

function readPackageVersion(packageRoot) {
  try {
    const value = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    return typeof value.version === "string" ? value.version : "unknown";
  } catch {
    return "unknown";
  }
}

function runtimeFromCliPath(cliPath, source = "bundled") {
  const resolvedCli = resolve(cliPath);
  if (!existsSync(resolvedCli)) {
    throw new Error(`Pi runtime CLI does not exist: ${resolvedCli}`);
  }
  const distDir = dirname(resolvedCli);
  const packageRoot = dirname(distDir);
  return {
    command: process.execPath,
    argsPrefix: [resolvedCli],
    source,
    cliPath: resolvedCli,
    packageRoot,
    version: readPackageVersion(packageRoot),
    display: `${process.execPath} ${resolvedCli}`
  };
}

export function resolveBundledPiRuntime({ env = process.env } = {}) {
  const testCli = env.PI_CASCADE_INTERNAL_PI_CLI;
  if (testCli) return runtimeFromCliPath(testCli, "internal-override");

  let entryUrl;
  try {
    entryUrl = import.meta.resolve(PI_RUNTIME_PACKAGE);
  } catch (error) {
    // A direct path fallback keeps development checkouts usable when Node's
    // package resolver cannot see a hoisted global dependency.
    const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const directCli = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    if (existsSync(directCli)) return runtimeFromCliPath(directCli, "bundled-direct");
    throw new Error(
      `Bundled Pi runtime ${PI_RUNTIME_PACKAGE}@${PINNED_PI_RUNTIME_VERSION} is unavailable. ` +
      `Reinstall Pi Cascade so npm installs its runtime dependency. Original resolution error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const entryPath = fileURLToPath(entryUrl);
  const cliPath = join(dirname(entryPath), "cli.js");
  return runtimeFromCliPath(cliPath, "bundled-dependency");
}

function isAutomaticRuntime(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !normalized || ["auto", "bundled", "embedded", "dependency"].includes(normalized);
}

export function resolvePiRuntime(config = {}, { env = process.env } = {}) {
  const explicit = env.PI_CASCADE_PI_BIN || config.piBinary;
  if (!isAutomaticRuntime(explicit)) {
    const value = String(explicit);
    const command = isAbsolute(value) || value.includes("/") || value.includes("\\") ? resolve(value) : value;
    return {
      command,
      argsPrefix: [],
      source: "explicit-binary",
      cliPath: command,
      packageRoot: dirname(command),
      version: "external",
      display: command
    };
  }
  return resolveBundledPiRuntime({ env });
}

export function assertRuntimeIsNotCascade(runtime) {
  const paths = [runtime.command, ...(runtime.argsPrefix || [])].map((value) => basename(String(value)).toLowerCase());
  if (paths.some((name) => name === "pi-cascade" || name === "pi-cascade.mjs")) {
    throw new Error("Pi runtime resolved to pi-cascade itself; refusing recursive launch");
  }
}

export function spawnPi(config, args, options = {}) {
  const runtime = resolvePiRuntime(config, { env: options.env || process.env });
  assertRuntimeIsNotCascade(runtime);
  const launch = normalizeExecutableLaunch(runtime.command, [...runtime.argsPrefix, ...args]);
  const child = spawn(launch.command, launch.args, options);
  return { child, runtime, launch };
}

export function checkPiRuntime(config = {}, { env = process.env, timeoutMs = 15000 } = {}) {
  try {
    const runtime = resolvePiRuntime(config, { env });
    assertRuntimeIsNotCascade(runtime);
    const launch = normalizeExecutableLaunch(runtime.command, [...runtime.argsPrefix, "--version"]);
    const result = spawnSync(launch.command, launch.args, {
      env,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true
    });
    return {
      ok: !result.error && result.status === 0,
      runtime,
      status: result.status,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim(),
      error: result.error?.message
    };
  } catch (error) {
    return {
      ok: false,
      runtime: undefined,
      status: null,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function runtimeSummary(config = {}, options = {}) {
  const result = checkPiRuntime(config, options);
  return {
    ok: result.ok,
    source: result.runtime?.source,
    version: result.runtime?.version,
    cliPath: result.runtime?.cliPath,
    command: result.runtime?.command,
    argsPrefix: result.runtime?.argsPrefix,
    reportedVersion: result.stdout,
    error: result.error || result.stderr || undefined
  };
}
