import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("offline local model drives a real Cascade/Pi TUI turn and edits a file", {
  skip: process.platform === "win32" ? "Unix PTY smoke test" : false,
  timeout: 60_000
}, () => {
  const result = spawnSync("python3", [join(root, "scripts", "tui-agent-smoke.py")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Offline end-to-end Cascade\/Pi TUI agent edit passed/);
});
