import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { nowIso, truncateText } from "./util.mjs";

function readPackageScripts(cwd) {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")).scripts || {};
  } catch {
    return {};
  }
}

function detectPackageManager(cwd) {
  if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function packageCommand(manager, script) {
  if (manager === "npm") return `npm run ${script}`;
  return `${manager} ${script}`;
}

export function discoverVerificationCommands(cwd, configured = []) {
  const root = resolve(cwd);
  const commands = [];
  const seen = new Set();
  const add = (command, kind, source, required = true) => {
    const text = String(command || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    commands.push({ id: `${kind}-${commands.length + 1}`, command: text, kind, source, required });
  };

  for (const item of configured || []) {
    if (typeof item === "string") add(item, "configured", "cascade.json", true);
    else if (item && typeof item === "object") add(item.command, item.kind || "configured", item.source || "cascade.json", item.required !== false);
  }

  const scripts = readPackageScripts(root);
  const manager = detectPackageManager(root);
  for (const name of ["test", "check", "typecheck", "lint", "build"]) {
    if (scripts[name]) add(packageCommand(manager, name), name, "package.json", name !== "build");
  }
  if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "pytest.ini")) || existsSync(join(root, "tests"))) {
    add("python -m pytest", "test", "python project", true);
  }
  if (existsSync(join(root, "Cargo.toml"))) {
    add("cargo test", "test", "Cargo.toml", true);
    add("cargo check", "typecheck", "Cargo.toml", true);
  }
  if (existsSync(join(root, "go.mod"))) add("go test ./...", "test", "go.mod", true);
  if (existsSync(join(root, "Makefile")) && commands.length === 0) add("make test", "test", "Makefile", false);
  return commands;
}

function normalizeCommand(command) {
  return String(command || "").trim().replace(/\s+/g, " ");
}

/**
 * Return true only when a successful shell command corresponds to a verifier
 * discovered from repository metadata or explicitly configured by the user.
 * Extra arguments are allowed, but arbitrary commands containing words such as
 * "test" or "build" are not treated as proof.
 */
export function isTrustedVerificationCommand(command, plan = []) {
  const candidate = normalizeCommand(command);
  if (!candidate) return false;
  return plan.some((item) => {
    const verifier = normalizeCommand(item?.command);
    if (!verifier) return false;
    return candidate === verifier || candidate.startsWith(`${verifier} `);
  });
}

export async function runCommand(command, { cwd, timeoutMs = 600000, env = process.env, signal, maximumOutput = 80000 } = {}) {
  const startedAt = Date.now();
  const shell = process.platform === "win32" ? true : "/bin/sh";
  return await new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      env,
      shell,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, timeoutMs);
    const abort = () => {
      child.kill("SIGTERM");
      settle({
        command,
        ok: false,
        aborted: true,
        code: null,
        signal: null,
        stdout: truncateText(stdout, maximumOutput),
        stderr: truncateText(stderr, maximumOutput),
        durationMs: Date.now() - startedAt,
        at: nowIso()
      });
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = truncateText(`${stdout}${chunk}`, maximumOutput); });
    child.stderr.on("data", (chunk) => { stderr = truncateText(`${stderr}${chunk}`, maximumOutput); });
    child.on("error", (error) => settle({
      command,
      ok: false,
      error: error.message,
      code: null,
      signal: null,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      at: nowIso()
    }));
    child.on("close", (code, childSignal) => settle({
      command,
      ok: code === 0 && !timedOut,
      timedOut,
      code,
      signal: childSignal,
      stdout: truncateText(stdout, maximumOutput),
      stderr: truncateText(stderr, maximumOutput),
      durationMs: Date.now() - startedAt,
      at: nowIso()
    }));
  });
}

export async function runVerificationPlan(commands, options = {}) {
  const results = [];
  for (const item of commands) {
    const result = await runCommand(item.command, options);
    results.push({ ...item, ...result });
    if (!result.ok && item.required !== false) break;
  }
  const required = results.filter((result) => result.required !== false);
  return {
    cwd: resolve(options.cwd || process.cwd()),
    startedAt: results[0]?.at || nowIso(),
    completedAt: nowIso(),
    ok: required.every((result) => result.ok),
    results
  };
}

export function formatVerificationPlan(plan) {
  if (!plan.length) return "No verification commands discovered.";
  return plan.map((item) => `- ${item.required === false ? "optional" : "required"} ${item.kind}: ${item.command} (${item.source})`).join("\n");
}

export function summarizeVerificationReport(report) {
  const lines = [`Verification ${report.ok ? "passed" : "failed"}:`];
  for (const result of report.results) {
    lines.push(`- ${result.ok ? "PASS" : "FAIL"} ${result.command} (${result.durationMs} ms${result.code === null ? "" : `, exit ${result.code}`})`);
    const detail = result.ok ? result.stdout : `${result.stderr}\n${result.stdout}`;
    if (detail.trim()) lines.push(`  ${truncateText(detail.replace(/\s+/g, " ").trim(), 500)}`);
  }
  return lines.join("\n");
}

export function executableName(command) {
  return basename(String(command).trim().split(/\s+/)[0] || "");
}
