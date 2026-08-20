import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("real Cascade TUI is branded and isolated from Pi state and extensions", { skip: process.platform === "win32" }, () => {
  const sandbox = mkdtempSync(join(tmpdir(), "cascade-real-tui-"));
  const home = join(sandbox, "home");
  const project = join(sandbox, "project");
  const piMarker = join(sandbox, "pi-extension-loaded");
  const cascadeMarker = join(sandbox, "cascade-extension-loaded");
  mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
  mkdirSync(join(home, ".cascade", "agent", "extensions"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "AGENTS.md"), "PI_ONLY_CONTEXT_SENTINEL\n");
  writeFileSync(join(home, ".pi", "agent", "extensions", "pi-only-sentinel.mjs"), `
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(piMarker)}, "loaded");
    export default function () {}
  `);
  writeFileSync(join(home, ".cascade", "agent", "extensions", "cascade-only-sentinel.mjs"), `
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(cascadeMarker)}, "loaded");
    export default function (app) {
      app.registerCommand("cascade-only-sentinel", { description: "isolation proof", handler() {} });
    }
  `);
  const result = spawnSync("python3", [
    join(root, "scripts", "tui-smoke.py"),
    "--root", root,
    "--cwd", project,
    "--home", home
  ], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.trim().split(/\n/).at(-1));
  assert.equal(report.hasCascadeBrand, true, report.tail);
  assert.equal(report.hasOldPiHeader, false, report.tail);
  assert.equal(report.hasPiContext, false, report.tail);
  assert.equal(report.hasNativeModelHint, true, report.tail);
  assert.equal(report.hasClearSingleStatus, true, report.tail);
  assert.equal(report.hasClearDualStatus, true, report.tail);
  assert.equal(report.hasCrypticStatus, false, report.tail);
  assert.equal(existsSync(piMarker), false, "Cascade executed an extension from ~/.pi");
  assert.equal(existsSync(cascadeMarker), true, "Cascade did not load an extension from ~/.cascade");
});
