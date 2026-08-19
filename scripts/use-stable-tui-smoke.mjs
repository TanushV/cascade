#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
const path = "package.json";
const pkg = JSON.parse(await readFile(path, "utf8"));
pkg.scripts ||= {};
pkg.scripts["tui:smoke"] = "node scripts/tui-smoke-stable.mjs";
await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log("Stable real PTY smoke selected.");
