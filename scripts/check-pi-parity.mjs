#!/usr/bin/env node
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function requireCondition(condition, message) {
  if (!condition) {
    console.error(message);
    process.exitCode = 1;
  }
}

const extension = read("extension/index.mjs");
const defaults = read("extension/core/defaults.mjs");
const setup = read("extension/core/tui-setup.mjs");
const readme = read("README.md");

requireCondition(!extension.includes("pi.setActiveTools("), "Cascade must not replace Pi's active tool set");
for (const command of ["model", "login", "settings"]) {
  requireCondition(
    !extension.includes(`registerCommand(\"${command}\"`) && !extension.includes(`registerCommand('${command}'`),
    `Cascade must not override Pi's native /${command} command`
  );
}
requireCondition(extension.includes('registerCommand("cascade-setup"'), "Cascade must expose /cascade-setup");
requireCondition(extension.includes('pi.on("model_select"'), "Cascade must observe native Pi model selection");
requireCondition(defaults.includes('mode: "single"'), "Cascade must default to Pi-parity single mode");
requireCondition(defaults.includes("useNativeModel: true"), "The default worker must inherit Pi's active model");
requireCondition(defaults.includes("autoConsult: false"), "Automatic expert calls must require setup or explicit configuration");
requireCondition(setup.includes("Configure credentials first with Pi /login"), "TUI setup must route credentials through Pi /login");
requireCondition(readme.includes("/cascade-setup"), "README must document the TUI setup command");
requireCondition(readme.includes("/login"), "README must document native Pi credential setup");

if (!process.exitCode) console.log("Pi parity invariants passed.");
