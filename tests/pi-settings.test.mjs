import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = dirname(dirname(fileURLToPath(import.meta.url)));

import {
  DEFAULT_PI_COMPACTION,
  getPiGlobalCompaction,
  normalizeCompactionSettings,
  writePiGlobalCompaction
} from "../extension/core/pi-settings.mjs";

test("global Pi compaction defaults match the pinned Pi runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-compaction-defaults-"));
  const result = getPiGlobalCompaction({ PI_CODING_AGENT_DIR: dir });
  assert.deepEqual(result.compaction, DEFAULT_PI_COMPACTION);
});

test("global compaction limits persist without destroying unrelated Pi settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-compaction-write-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify({ theme: "dark", compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 2000 } }));
  const result = writePiGlobalCompaction({ enabled: true, reserveTokens: 24000, keepRecentTokens: 32000 }, { PI_CODING_AGENT_DIR: dir });
  assert.equal(result.path, path);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.theme, "dark");
  assert.deepEqual(saved.compaction, { enabled: true, reserveTokens: 24000, keepRecentTokens: 32000 });
});

test("global compaction token limits reject invalid values", () => {
  assert.throws(() => normalizeCompactionSettings({ reserveTokens: 0 }), /positive integer/);
  assert.throws(() => normalizeCompactionSettings({ keepRecentTokens: 1.5 }), /positive integer/);
});


test("compaction CLI edits and reads Pi's global limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-compaction-cli-"));
  const env = { ...process.env, PI_CODING_AGENT_DIR: dir };
  const set = spawnSync(process.execPath, [
    join(root, "bin", "cascade.mjs"),
    "compaction", "set",
    "--enabled", "true",
    "--reserve-tokens", "28000",
    "--keep-recent-tokens", "36000"
  ], { env, encoding: "utf8" });
  assert.equal(set.status, 0, set.stderr);
  const show = spawnSync(process.execPath, [join(root, "bin", "cascade.mjs"), "compaction", "show"], { env, encoding: "utf8" });
  assert.equal(show.status, 0, show.stderr);
  const parsed = JSON.parse(show.stdout);
  assert.deepEqual(parsed.compaction, { enabled: true, reserveTokens: 28000, keepRecentTokens: 36000 });
});
