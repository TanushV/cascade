import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWriteJson, deepMerge } from "./util.mjs";

export const DEFAULT_PI_COMPACTION = Object.freeze({
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000
});

function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function getPiAgentDir(env = process.env) {
  return resolve(expandHome(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")));
}

export function getPiGlobalSettingsPath(env = process.env) {
  return join(getPiAgentDir(env), "settings.json");
}

export function readPiGlobalSettings(env = process.env) {
  const path = getPiGlobalSettingsPath(env);
  if (!existsSync(path)) return { path, settings: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      path,
      settings: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    };
  } catch (error) {
    throw new Error(`Invalid Pi settings JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function normalizeCompactionSettings(value = {}) {
  return {
    enabled: value.enabled === undefined ? DEFAULT_PI_COMPACTION.enabled : Boolean(value.enabled),
    reserveTokens: positiveInteger(
      value.reserveTokens ?? DEFAULT_PI_COMPACTION.reserveTokens,
      "reserveTokens"
    ),
    keepRecentTokens: positiveInteger(
      value.keepRecentTokens ?? DEFAULT_PI_COMPACTION.keepRecentTokens,
      "keepRecentTokens"
    )
  };
}

export function getPiGlobalCompaction(env = process.env) {
  const { path, settings } = readPiGlobalSettings(env);
  return {
    path,
    compaction: normalizeCompactionSettings(settings.compaction || {})
  };
}

export function writePiGlobalCompaction(compaction, env = process.env) {
  const { path, settings } = readPiGlobalSettings(env);
  const normalized = normalizeCompactionSettings(compaction);
  const next = deepMerge(settings, { compaction: normalized });
  atomicWriteJson(path, next, 0o600);
  return { path, compaction: normalized, settings: next };
}

export async function runGlobalCompactionWizard(ctx) {
  if (!ctx?.hasUI) throw new Error("Global compaction setup requires Pi's interactive UI");
  const current = getPiGlobalCompaction();
  const enabledChoice = await ctx.ui.select("Cascade · Global auto-compaction", [
    current.compaction.enabled ? "Enabled (current)" : "Enabled",
    current.compaction.enabled ? "Disabled" : "Disabled (current)",
    "Cancel"
  ]);
  if (!enabledChoice || enabledChoice === "Cancel") return { cancelled: true };
  const enabled = enabledChoice.startsWith("Enabled");

  const reserveText = await ctx.ui.input(
    "Cascade · Tokens reserved for the next model response",
    String(current.compaction.reserveTokens)
  );
  if (reserveText === undefined) return { cancelled: true };
  const keepText = await ctx.ui.input(
    "Cascade · Recent tokens kept verbatim during compaction",
    String(current.compaction.keepRecentTokens)
  );
  if (keepText === undefined) return { cancelled: true };

  let normalized;
  try {
    normalized = normalizeCompactionSettings({
      enabled,
      reserveTokens: reserveText,
      keepRecentTokens: keepText
    });
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    return { cancelled: true };
  }

  const confirmed = await ctx.ui.confirm(
    "Save global Pi compaction limits?",
    [
      `File: ${current.path}`,
      `Auto-compaction: ${normalized.enabled ? "enabled" : "disabled"}`,
      `Reserve tokens: ${normalized.reserveTokens}`,
      `Keep recent tokens: ${normalized.keepRecentTokens}`,
      "",
      "The limits apply to new Cascade/Pi sessions."
    ].join("\n")
  );
  if (!confirmed) return { cancelled: true };
  return { cancelled: false, ...writePiGlobalCompaction(normalized) };
}
