import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { loadEvaluationManifest, runEvaluation } from "./eval.mjs";
import { HarnessStore } from "./harness.mjs";
import { atomicWriteJson, nowIso } from "./util.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function safeLink(source, target) {
  if (!existsSync(source) || existsSync(target)) return;
  try { symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir"); } catch {}
}

function copyWorkspace(source, target) {
  cpSync(source, target, {
    recursive: true,
    dereference: false,
    filter(path) {
      const name = path.split(/[\\/]/).pop();
      return name !== ".git" && name !== ".pi-cascade-replay";
    }
  });
}

function createIsolatedWorkspace(sourceCwd, root, label, index, { preferGit = true } = {}) {
  const source = resolve(sourceCwd);
  const target = join(root, `${label}-${index}`);
  if (preferGit) {
    try {
      const repositoryRoot = git(source, ["rev-parse", "--show-toplevel"]);
      const relativeCwd = relative(repositoryRoot, source);
      git(repositoryRoot, ["worktree", "add", "--detach", target, "HEAD"]);
      safeLink(join(repositoryRoot, "node_modules"), join(target, "node_modules"));
      return {
        cwd: resolve(target, relativeCwd),
        cleanup() {
          try { git(repositoryRoot, ["worktree", "remove", "--force", target]); }
          catch { rmSync(target, { recursive: true, force: true }); }
        }
      };
    } catch {}
  }
  mkdirSync(dirname(target), { recursive: true });
  copyWorkspace(source, target);
  return { cwd: target, cleanup() { rmSync(target, { recursive: true, force: true }); } };
}

function createIsolatedManifest(manifestPath, temporaryRoot, label, options) {
  const { manifest, path } = loadEvaluationManifest(manifestPath);
  const workspaces = [];
  const tasks = manifest.tasks.map((task, index) => {
    const source = resolve(dirname(path), task.cwd || ".");
    const workspace = createIsolatedWorkspace(source, temporaryRoot, label, index, options);
    workspaces.push(workspace);
    return { ...task, cwd: workspace.cwd };
  });
  const isolatedPath = join(temporaryRoot, `${label}-manifest.json`);
  writeFileSync(isolatedPath, `${JSON.stringify({ ...manifest, tasks }, null, 2)}\n`, "utf8");
  return { path: isolatedPath, workspaces };
}


function createDirectManifest(manifestPath, temporaryRoot, label) {
  const { manifest, path } = loadEvaluationManifest(manifestPath);
  const tasks = manifest.tasks.map((task) => ({
    ...task,
    cwd: resolve(dirname(path), task.cwd || ".")
  }));
  const directPath = join(temporaryRoot, `${label}-manifest.json`);
  writeFileSync(directPath, `${JSON.stringify({ ...manifest, tasks }, null, 2)}\n`, "utf8");
  return { path: directPath, workspaces: [] };
}

function relativeDelta(candidate, baseline) {
  const before = Number(baseline || 0);
  const after = Number(candidate || 0);
  if (before === 0) return after === 0 ? 0 : 1;
  return (after - before) / Math.abs(before);
}

function complexityDelta(harness, candidate) {
  const active = harness.listEntries().filter((entry) => entry.status === "active");
  const baseline = active.reduce((sum, entry) => sum + String(entry.content || "").length, 0);
  let delta = 0;
  for (const edit of candidate.edits || []) {
    if (edit.action === "delete") {
      const existing = active.find((entry) => entry.id === edit.id && entry.scope === candidate.scope);
      delta -= String(existing?.content || "").length;
    } else if (edit.action === "update") {
      const existing = active.find((entry) => entry.id === edit.id && entry.scope === candidate.scope);
      delta += String(edit.content || "").length - String(existing?.content || "").length;
    } else {
      delta += String(edit.content || "").length;
    }
  }
  return delta <= 0 ? 0 : delta / Math.max(1000, baseline);
}

export async function runHarnessReplay({
  candidateId,
  manifestPath,
  config,
  cwd = process.cwd(),
  executable,
  packageRoot,
  outputPath,
  baseEnv = process.env,
  expertReviewed = false,
  isolate = true
}) {
  const harness = new HarnessStore({ cwd, config, sessionId: "replay-controller" });
  const candidate = harness.requireCandidate(candidateId);
  if ((candidate.edits || []).some((edit) => !["prompt", "memory"].includes(edit.kind))) {
    throw new Error("Automatic replay currently supports prompt and memory candidates; executable harness changes require a built candidate branch");
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-cascade-replay-"));
  const configPath = join(temporaryRoot, "cascade.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  let baselineIsolation;
  let candidateIsolation;
  try {
    baselineIsolation = isolate
      ? createIsolatedManifest(manifestPath, temporaryRoot, "baseline", { preferGit: true })
      : createDirectManifest(manifestPath, temporaryRoot, "baseline");
    candidateIsolation = isolate
      ? createIsolatedManifest(manifestPath, temporaryRoot, "candidate", { preferGit: true })
      : createDirectManifest(manifestPath, temporaryRoot, "candidate");
    const commonEnv = {
      ...baseEnv,
      PI_CASCADE_CONFIG: configPath,
      PI_CASCADE_PROJECT_TRUSTED: "1",
      PI_CASCADE_HARNESS_MODE: "observe"
    };
    const baseline = await runEvaluation({
      manifestPath: baselineIsolation.path,
      executable,
      packageRoot,
      baseEnv: commonEnv,
      extraEnv: { PI_CASCADE_CANARY_IDS: "" },
      label: `baseline:${candidateId}`
    });
    const canary = await runEvaluation({
      manifestPath: candidateIsolation.path,
      executable,
      packageRoot,
      baseEnv: commonEnv,
      extraEnv: { PI_CASCADE_CANARY_IDS: candidateId },
      label: `candidate:${candidateId}`
    });
    const metrics = {
      taskCount: canary.taskCount,
      qualityDelta: canary.successRate - baseline.successRate,
      costDelta: relativeDelta(canary.totalCostUsd, baseline.totalCostUsd),
      latencyDelta: relativeDelta(canary.totalDurationMs, baseline.totalDurationMs),
      expertCallRateDelta:
        canary.totalExpertCalls / Math.max(1, canary.taskCount) - baseline.totalExpertCalls / Math.max(1, baseline.taskCount),
      complexityDelta: complexityDelta(harness, candidate),
      deterministicChecksPassed: canary.results.every((result) => result.accepted),
      expertReviewed,
      notes: `Automatic replay completed at ${nowIso()}`
    };
    const evaluation = harness.evaluate(candidateId, metrics);
    const report = {
      schema: 1,
      candidateId,
      completedAt: nowIso(),
      baseline,
      candidate: canary,
      metrics,
      admission: evaluation.admission
    };
    if (outputPath) atomicWriteJson(resolve(outputPath), report, 0o644);
    return report;
  } finally {
    for (const item of baselineIsolation?.workspaces || []) item.cleanup();
    for (const item of candidateIsolation?.workspaces || []) item.cleanup();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function formatHarnessReplay(report) {
  return [
    `Harness replay ${report.candidateId}:`,
    `- quality delta: ${(report.metrics.qualityDelta * 100).toFixed(2)} points`,
    `- cost delta: ${(report.metrics.costDelta * 100).toFixed(2)}%`,
    `- latency delta: ${(report.metrics.latencyDelta * 100).toFixed(2)}%`,
    `- expert-call-rate delta: ${(report.metrics.expertCallRateDelta * 100).toFixed(2)} points`,
    `- complexity delta: ${(report.metrics.complexityDelta * 100).toFixed(2)}%`,
    `- promotion: ${report.admission.allowed ? "admitted" : `blocked (${report.admission.reasons.join("; ")})`}`
  ].join("\n");
}
