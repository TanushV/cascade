#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const forbidden = [
  ["PI", "CASCADE"].join("_"),
  ["pi", "cascade"].join("-"),
  ["Pi", "Cascade"].join(" "),
];

async function files(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await files(path, output);
    else output.push(path);
  }
  return output;
}

const violations = [];
for (const path of await files(root)) {
  const buffer = await readFile(path);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const token of forbidden) {
    if (text.includes(token)) violations.push(`${relative(root, path)} contains ${token}`);
  }
}

if (existsSync(join(root, "bin", forbidden[1] + ".mjs"))) {
  violations.push(`obsolete executable remains at bin/${forbidden[1]}.mjs`);
}
if (!existsSync(join(root, "bin", "cascade.mjs"))) {
  violations.push("bin/cascade.mjs is missing");
}

if (violations.length > 0) {
  console.error(`Cascade branding check failed:\n- ${violations.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Cascade branding check passed.");
}
