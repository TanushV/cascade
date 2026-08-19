import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("real bundled Pi TUI starts, preserves tools, opens setup/model/login, and exits cleanly", { skip: process.platform === "win32" }, () => {
  const result = spawnSync("python3", [join(root, "scripts", "tui-smoke.py")], {
    cwd: root,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 90000
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /TUI smoke test passed/);
});
