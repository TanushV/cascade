#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];
const required = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/PI-LICENSE.txt",
  "UPSTREAM.json",
  "docs/legal.md",
  "CONTRIBUTING.md",
  "SECURITY.md"
];
for (const path of required) {
  if (!existsSync(join(root, path))) failures.push(`Missing legal file: ${path}`);
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.license !== "MIT") failures.push("package.json license must be MIT");
if (pkg.dependencies?.["@earendil-works/pi-coding-agent"] !== "0.84.2") {
  failures.push("Pi runtime dependency must remain pinned to 0.84.2 unless the legal and compatibility records are updated");
}
const upstream = JSON.parse(readFileSync(join(root, "UPSTREAM.json"), "utf8"));
if (upstream.repository !== "earendil-works/pi") failures.push("UPSTREAM.json repository is incorrect");
if (upstream.codingAgentVersion !== pkg.dependencies?.["@earendil-works/pi-coding-agent"]) {
  failures.push("UPSTREAM.json and package.json Pi versions differ");
}
const piLicense = readFileSync(join(root, "licenses/PI-LICENSE.txt"));
const piLicenseHash = createHash("sha256").update(piLicense).digest("hex");
if (piLicenseHash !== "4f6a1985796db5225e3b1e59972bd47e07a27a0748427cb3d3c8fbf39f9311f0") {
  failures.push("The preserved Pi MIT license differs from the recorded upstream license");
}
const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
for (const text of ["Mario Zechner", "MIT", "not affiliated", "licenses/PI-LICENSE.txt"]) {
  if (!notices.includes(text)) failures.push(`Third-party notice is missing: ${text}`);
}
const legal = readFileSync(join(root, "docs/legal.md"), "utf8");
for (const text of ["independent", "not affiliated", "does **not** vendor", "not legal advice"]) {
  if (!legal.includes(text)) failures.push(`Legal note is missing: ${text}`);
}
for (const included of ["licenses", "THIRD_PARTY_NOTICES.md", "LICENSE", "docs"]) {
  if (!pkg.files?.includes(included)) failures.push(`Published package omits legal surface: ${included}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Legal and attribution checks passed.");
