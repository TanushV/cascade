import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const DEFAULT_UPDATE_SOURCE = "git+https://github.com/TanushV/cascade.git#main";
export const DEFAULT_VERSION_URL = "https://raw.githubusercontent.com/TanushV/cascade/main/package.json";

function numericVersion(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return undefined;
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = numericVersion(left);
  const b = numericVersion(right);
  if (!a || !b) throw new Error(`Unable to compare versions ${JSON.stringify(left)} and ${JSON.stringify(right)}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function updatePlan({ source = process.env.CASCADE_UPDATE_SOURCE || DEFAULT_UPDATE_SOURCE, prefix } = {}) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["install", "-g", source, "--ignore-scripts", "--no-audit", "--no-fund"];
  if (prefix) args.push("--prefix", resolve(prefix));
  return { command: npm, args, source };
}

export async function fetchRemoteVersion({
  versionUrl = process.env.CASCADE_UPDATE_VERSION_URL || DEFAULT_VERSION_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for update checks");
  const response = await fetchImpl(versionUrl, { headers: { accept: "application/json" } });
  if (!response?.ok) throw new Error(`Cascade update check failed with HTTP ${response?.status ?? "unknown"}`);
  const payload = await response.json();
  if (!numericVersion(payload?.version)) throw new Error("Cascade update metadata did not contain a valid version");
  return { version: payload.version, versionUrl };
}

export async function runSelfUpdate({
  dryRun = false,
  force = false,
  source,
  prefix,
  currentVersion,
  versionUrl,
  fetchImpl = globalThis.fetch,
  spawn = spawnSync
} = {}) {
  const plan = updatePlan({ source, prefix });
  if (dryRun) return { ok: true, dryRun: true, ...plan };

  let remote;
  if (!force && currentVersion) {
    remote = await fetchRemoteVersion({ versionUrl, fetchImpl });
    const comparison = compareVersions(remote.version, currentVersion);
    if (comparison < 0) {
      return {
        ok: true,
        skipped: true,
        reason: `remote version ${remote.version} is older than installed ${currentVersion}`,
        currentVersion,
        remoteVersion: remote.version,
        ...plan
      };
    }
    if (comparison === 0) {
      return {
        ok: true,
        skipped: true,
        reason: `Cascade ${currentVersion} is already current`,
        currentVersion,
        remoteVersion: remote.version,
        ...plan
      };
    }
  }

  const result = spawn(plan.command, plan.args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cascade update failed with exit code ${result.status}`);
  return {
    ok: true,
    dryRun: false,
    skipped: false,
    currentVersion,
    remoteVersion: remote?.version,
    ...plan,
    status: result.status
  };
}
