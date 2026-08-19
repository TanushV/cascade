import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("apply-to-pi creates a workspace package and minimal root scripts", () => {
  const pi = mkdtempSync(join(tmpdir(), "fake-pi-source-"));
  mkdirSync(join(pi, "packages", "coding-agent"), { recursive: true });
  writeFileSync(join(pi, "package.json"), JSON.stringify({ name: "pi-monorepo", private: true, workspaces: ["packages/*"], scripts: {} }));
  writeFileSync(join(pi, "packages", "coding-agent", "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.2" }));
  const result = spawnSync(process.execPath, [join(root, "scripts", "apply-to-pi.mjs"), "--pi-source", pi], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const rootPackage = JSON.parse(readFileSync(join(pi, "package.json"), "utf8"));
  assert.equal(rootPackage.scripts.cascade, "node packages/cascade/bin/cascade.mjs");
  assert.equal(rootPackage.scripts["cascade:check"], "npm run check --workspace=cascade");
  assert.match(readFileSync(join(pi, "CASCADE_UPSTREAM.json"), "utf8"), /59a71b/);
  assert.match(readFileSync(join(pi, "packages", "cascade", "README.md"), "utf8"), /Cascade/);
  assert.match(readFileSync(join(pi, "packages", "cascade", "UPSTREAM.json"), "utf8"), /0.84.2/);
  assert.ok(readFileSync(join(pi, "packages", "cascade", "tests", "router.test.mjs"), "utf8").includes("repeated verifier failures"));
});
