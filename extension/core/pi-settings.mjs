import { atomicWriteJson, deepMerge, readJsonFile } from "./util.mjs";
import { ensureCascadeAgentLayout, getCascadeSettingsPath } from "./cascade-paths.mjs";

export const DEFAULT_COMPACTION = Object.freeze({
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000
});

export function getCascadeGlobalCompaction(env = process.env) {
  ensureCascadeAgentLayout(env);
  const path = getCascadeSettingsPath(env);
  const settings = readJsonFile(path, { optional: true }) || {};
  return {
    path,
    compaction: {
      ...DEFAULT_COMPACTION,
      ...(settings.compaction || {})
    }
  };
}

export function writeCascadeGlobalCompaction(patch, env = process.env) {
  ensureCascadeAgentLayout(env);
  const path = getCascadeSettingsPath(env);
  const settings = readJsonFile(path, { optional: true }) || {};
  const nextCompaction = { ...DEFAULT_COMPACTION, ...(settings.compaction || {}) };
  if (patch.enabled !== undefined) nextCompaction.enabled = Boolean(patch.enabled);
  for (const key of ["reserveTokens", "keepRecentTokens"]) {
    if (patch[key] !== undefined) {
      const value = Number(patch[key]);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
      nextCompaction[key] = value;
    }
  }
  if (nextCompaction.keepRecentTokens <= 0 || nextCompaction.reserveTokens <= 0) {
    throw new Error("Compaction limits must be positive");
  }
  const next = deepMerge(settings, { quietStartup: true, compaction: nextCompaction });
  atomicWriteJson(path, next, 0o600);
  return { path, compaction: nextCompaction };
}
