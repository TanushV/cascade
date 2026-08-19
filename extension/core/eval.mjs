import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeUsage } from "./ledger.mjs";
import { normalizeExecutableLaunch } from "./pi-runtime.mjs";
import { runVerificationPlan } from "./verification.mjs";
import { atomicWriteJson, nowIso, truncateText } from "./util.mjs";

export function loadEvaluationManifest(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`Evaluation manifest not found: ${resolved}`);
  const value = JSON.parse(readFileSync(resolved, "utf8"));
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new Error("Evaluation manifest requires a non-empty tasks array");
  }
  return { manifest: value, path: resolved };
}

function parseJsonLine(line, state) {
  try {
    const event = JSON.parse(line);
    state.events += 1;
    if (event.usage) state.usage = event.usage;
    if (event.type === "tool_execution_start" && event.toolName === "cascade_expert") state.expertCalls += 1;
    if (event.type === "message_end" && event.message?.role === "assistant") {
      state.final = event.message;
      if (event.message.usage) state.usage = event.message.usage;
    }
    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      state.final = [...event.messages].reverse().find((message) => message?.role === "assistant") || state.final;
    }
  } catch {
    state.unparsed.push(truncateText(line, 1000));
  }
}

function textOf(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((item) => item?.type === "text").map((item) => item.text).join("\n");
}

async function runTaskProcess({ executable, args, cwd, env, timeoutMs }) {
  const startedAt = Date.now();
  const state = { events: 0, expertCalls: 0, final: undefined, usage: {}, unparsed: [] };
  return await new Promise((resolvePromise) => {
    const launch = normalizeExecutableLaunch(executable, args);
    const child = spawn(launch.command, launch.args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let remainder = "";
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = truncateText(`${stdout}${chunk}`, 200000);
      remainder += chunk;
      for (;;) {
        const newline = remainder.indexOf("\n");
        if (newline < 0) break;
        const line = remainder.slice(0, newline).trim();
        remainder = remainder.slice(newline + 1);
        if (line) parseJsonLine(line, state);
      }
    });
    child.stderr.on("data", (chunk) => { stderr = truncateText(`${stderr}${chunk}`, 100000); });
    child.on("error", (error) => settle({
      ok: false,
      error: error.message,
      code: null,
      stdout,
      stderr,
      state,
      durationMs: Date.now() - startedAt
    }));
    child.on("close", (code, signal) => {
      if (remainder.trim()) parseJsonLine(remainder.trim(), state);
      settle({
        ok: code === 0 && !timedOut,
        code,
        signal,
        timedOut,
        stdout,
        stderr,
        state,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

export async function runEvaluation({
  manifestPath,
  executable,
  packageRoot,
  outputPath,
  baseEnv = process.env,
  extraEnv = {},
  label = "evaluation"
}) {
  const startedAt = nowIso();
  const { manifest, path } = loadEvaluationManifest(manifestPath);
  const results = [];
  for (const task of manifest.tasks) {
    const cwd = resolve(dirname(path), task.cwd || ".");
    const mode = task.mode || manifest.mode || "dual";
    const args = ["--mode", "json", "--cascade-mode", mode, "--"];
    if (task.piArgs) args.push(...task.piArgs.map(String));
    args.push(String(task.prompt || ""));
    const run = await runTaskProcess({
      executable,
      args,
      cwd,
      env: {
        ...baseEnv,
        ...extraEnv,
        CASCADE_EVAL: "1",
        CASCADE_PACKAGE_ROOT: packageRoot
      },
      timeoutMs: Number(task.timeoutMs || manifest.timeoutMs || 900000)
    });
    const verificationCommands = (task.verification || []).map((item, index) =>
      typeof item === "string"
        ? { id: `task-${index}`, command: item, kind: "evaluation", source: path, required: true }
        : { id: `task-${index}`, required: true, ...item }
    );
    const verification = run.ok
      ? await runVerificationPlan(verificationCommands, {
          cwd,
          timeoutMs: Number(task.verificationTimeoutMs || manifest.verificationTimeoutMs || 600000)
        })
      : { ok: false, results: [] };
    const usage = normalizeUsage(run.state.usage);
    results.push({
      id: task.id || `task-${results.length + 1}`,
      cwd,
      mode,
      process: {
        ok: run.ok,
        code: run.code,
        signal: run.signal,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
        stderr: truncateText(run.stderr, 8000),
        eventCount: run.state.events,
        expertCalls: run.state.expertCalls,
        usage,
        costUsd: usage.cost,
        finalText: truncateText(textOf(run.state.final), 16000)
      },
      verification,
      accepted: run.ok && verification.ok
    });
  }
  const accepted = results.filter((result) => result.accepted).length;
  const report = {
    schema: 1,
    label,
    manifest: path,
    startedAt,
    completedAt: nowIso(),
    taskCount: results.length,
    accepted,
    successRate: accepted / results.length,
    totalCostUsd: results.reduce((sum, result) => sum + Number(result.process.costUsd || 0), 0),
    totalDurationMs: results.reduce((sum, result) => sum + Number(result.process.durationMs || 0), 0),
    totalExpertCalls: results.reduce((sum, result) => sum + Number(result.process.expertCalls || 0), 0),
    results
  };
  if (outputPath) atomicWriteJson(resolve(outputPath), report, 0o644);
  return report;
}

export function formatEvaluation(report) {
  const lines = [
    `Evaluation: ${report.accepted}/${report.taskCount} accepted (${(report.successRate * 100).toFixed(1)}%), $${Number(report.totalCostUsd || 0).toFixed(4)}, ${report.totalExpertCalls || 0} expert calls`
  ];
  for (const result of report.results) {
    lines.push(`- ${result.accepted ? "PASS" : "FAIL"} ${result.id}: process=${result.process.ok}, verification=${result.verification.ok}, ${result.process.durationMs} ms`);
  }
  return lines.join("\n");
}
