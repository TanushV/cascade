import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const extension = readFileSync(new URL("../extension/index.mjs", import.meta.url), "utf8");
const defaults = readFileSync(new URL("../extension/core/defaults.mjs", import.meta.url), "utf8");

test("Cascade never replaces Pi active tools in the parent TUI", () => {
  assert.equal(extension.includes("pi.setActiveTools("), false);
});

test("Cascade does not shadow native Pi model, login, or settings commands", () => {
  for (const command of ["model", "login", "settings"]) {
    assert.equal(extension.includes(`registerCommand(\"${command}\"`), false);
    assert.equal(extension.includes(`registerCommand('${command}'`), false);
  }
  assert.equal(extension.includes('registerCommand("cascade-setup"'), true);
});

test("Cascade defaults to native Pi single-model behavior", () => {
  assert.match(defaults, /mode:\s*"single"/);
  assert.match(defaults, /worker:\s*\{[\s\S]*?useNativeModel:\s*true/);
  assert.match(defaults, /autoConsult:\s*false/);
});
