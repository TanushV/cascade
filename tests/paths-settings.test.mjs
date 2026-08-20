import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCascadeResources, ensureCascadeAgentLayout, getCascadeAgentDir } from "../extension/core/cascade-paths.mjs";
import { getCascadeGlobalCompaction, writeCascadeGlobalCompaction } from "../extension/core/pi-settings.mjs";

test("Cascade owns an isolated application directory and ignores Pi resources", () => {
  const home = mkdtempSync(join(tmpdir(), "cascade-home-"));
  const project = join(home, "project");
  const env = { HOME: home };
  mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
  mkdirSync(join(home, ".cascade", "agent", "extensions"), { recursive: true });
  mkdirSync(join(project, ".cascade", "extensions"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "extensions", "pi-only.mjs"), "export default function() {}\n");
  writeFileSync(join(home, ".cascade", "agent", "extensions", "global.mjs"), "export default function() {}\n");
  writeFileSync(join(project, ".cascade", "extensions", "project.mjs"), "export default function() {}\n");
  ensureCascadeAgentLayout(env);
  assert.equal(getCascadeAgentDir(env), join(home, ".cascade", "agent"));
  const resources = discoverCascadeResources({ cwd: project, projectTrusted: true, env });
  assert.equal(resources.extensions.some((path) => path.includes(".pi")), false);
  assert.equal(resources.extensions.some((path) => path.endsWith("global.mjs")), true);
  assert.equal(resources.extensions.some((path) => path.endsWith("project.mjs")), true);
});

test("global compaction limits are persisted in Cascade settings", () => {
  const home = mkdtempSync(join(tmpdir(), "cascade-compaction-"));
  const env = { HOME: home };
  const result = writeCascadeGlobalCompaction({ enabled: true, reserveTokens: 12000, keepRecentTokens: 24000 }, env);
  assert.equal(result.compaction.reserveTokens, 12000);
  assert.equal(result.compaction.keepRecentTokens, 24000);
  const readback = getCascadeGlobalCompaction(env);
  assert.deepEqual(readback.compaction, { enabled: true, reserveTokens: 12000, keepRecentTokens: 24000 });
  assert.equal(JSON.parse(readFileSync(result.path, "utf8")).quietStartup, true);
  assert.equal(existsSync(join(home, ".pi")), false);
});
