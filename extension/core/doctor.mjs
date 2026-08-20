import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { evaluateContributorPolicy } from "./privacy.mjs";
import { checkPiRuntime } from "./pi-runtime.mjs";

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 15000, windowsHide: true });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error?.message
  };
}

function credentialStatus(config, env = process.env) {
  const required = new Map();
  for (const model of [config.worker, ...(config.mode === "dual" ? [config.expert] : [])]) {
    const provider = config.providers?.[model.provider];
    if (!provider) continue;
    const key = String(provider.apiKey || "");
    const match = key.match(/^\$(?:\{([^}]+)\}|([A-Za-z_][A-Za-z0-9_]*))$/);
    if (match) required.set(match[1] || match[2], model.provider);
  }
  return [...required].map(([name, provider]) => ({
    name,
    provider,
    configured: Boolean(env[name])
  }));
}

export function runDoctor({ config, cwd, packageRoot, validation, sources = [] }) {
  const checks = [];
  const add = (name, ok, detail, severity = "error") => checks.push({ name, ok: Boolean(ok), detail: String(detail || ""), severity });

  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  const nodeSupported = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 19);
  add("Node.js", nodeSupported, `v${process.versions.node}; bundled Pi requires Node 22.19 or newer`);

  const pi = checkPiRuntime(config);
  add(
    "Bundled Pi runtime",
    pi.ok,
    pi.ok
      ? `${pi.stdout || `v${pi.runtime?.version || "unknown"}`} via ${pi.runtime?.source || "unknown"} (${pi.runtime?.cliPath || pi.runtime?.display || "resolved"})`
      : pi.error || pi.stderr || "not found"
  );

  add("Configuration", validation.errors.length === 0, validation.errors.length ? validation.errors.join("; ") : "valid");
  for (const warning of validation.warnings) add("Configuration warning", true, warning, "warning");

  if (config.worker?.selectionMode === "configured") {
    const workerPolicy = evaluateContributorPolicy(config, config.worker);
    add("Worker data policy", workerPolicy.allowed, workerPolicy.reason);
  } else {
    add("Worker data policy", true, "native TUI model; policy is evaluated when a model is selected", "info");
  }
  if (config.mode === "dual") {
    const expertPolicy = evaluateContributorPolicy(config, config.expert);
    add("Expert data policy", expertPolicy.allowed, expertPolicy.reason);
  }

  for (const credential of credentialStatus(config)) {
    add(`Credential ${credential.name}`, credential.configured, `${credential.provider}: ${credential.configured ? "present" : "missing"}`, "warning");
  }

  if (config.workspaceRuntime?.enabled) {
    const python = commandAvailable(config.workspaceRuntime.pythonBinary || "python3");
    add("Programmatic workspace Python", python.ok, python.ok ? python.stdout || config.workspaceRuntime.pythonBinary : python.error || python.stderr || "not found");
    if (config.workspaceRuntime.sandboxCommand?.length) {
      const executable = String(config.workspaceRuntime.sandboxCommand[0])
        .replaceAll("{python}", config.workspaceRuntime.pythonBinary || "python3")
        .replaceAll("{script}", "--version")
        .replaceAll("{cwd}", cwd);
      const sandbox = commandAvailable(executable);
      add("Programmatic workspace sandbox", sandbox.ok, sandbox.ok ? executable : sandbox.error || sandbox.stderr || `${executable} not found`);
    } else {
      add(
        "Programmatic workspace sandbox",
        Boolean(config.workspaceRuntime.allowUnsandboxed),
        config.workspaceRuntime.allowUnsandboxed
          ? "unsandboxed execution explicitly acknowledged"
          : "no sandboxCommand configured",
        config.workspaceRuntime.allowUnsandboxed ? "warning" : "error"
      );
    }
  } else {
    add("Programmatic workspace", true, "disabled", "info");
  }


  add("Working directory", existsSync(cwd), cwd);
  add("Configuration sources", true, sources.map((source) => source.path || source.type).join(delimiter), "info");

  return {
    ok: checks.every((check) => check.ok || check.severity !== "error"),
    checks
  };
}

export function formatDoctor(report) {
  const lines = [];
  for (const check of report.checks) {
    const marker = check.ok ? "PASS" : check.severity === "warning" ? "WARN" : "FAIL";
    lines.push(`${marker.padEnd(4)} ${check.name}: ${check.detail}`);
  }
  lines.push("", report.ok ? "Cascade doctor passed." : "Cascade doctor found blocking problems.");
  return lines.join("\n");
}
