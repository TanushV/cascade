import { spawnSync } from "node:child_process";

export const DEFAULT_UPDATE_SPEC = "github:TanushV/cascade";

export function buildUpdateInvocation({
  npmExecPath = process.env.npm_execpath,
  spec = process.env.CASCADE_UPDATE_SPEC || DEFAULT_UPDATE_SPEC
} = {}) {
  const args = ["install", "-g", spec, "--ignore-scripts", "--no-audit", "--no-fund"];
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
      display: `npm ${args.join(" ")}`
    };
  }
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return { command, args, display: `${command} ${args.join(" ")}` };
}

export function runSelfUpdate({ dryRun = false, spec, env = process.env } = {}) {
  const invocation = buildUpdateInvocation({ npmExecPath: env.npm_execpath, spec });
  if (dryRun) return { ok: true, dryRun: true, ...invocation };
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32" && invocation.command.endsWith(".cmd")
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Cascade update failed with exit code ${result.status ?? "unknown"}`);
  }
  return { ok: true, dryRun: false, status: result.status, ...invocation };
}
