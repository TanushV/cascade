#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const path = "extension/index.mjs";
let source = await readFile(path, "utf8");

const oldSelection = `    switchingRoleModel = true;
    let changed;
    try {
      changed = await pi.setModel(model);
    } finally {
      switchingRoleModel = false;
    }
    if (!changed) throw new Error(\`No usable credentials for \${describeModel(target)}\`);`;
const newSelection = `    const active = modelFromContext(ctx);
    const alreadySelected = active?.provider === target.provider && active?.model === target.model;
    switchingRoleModel = true;
    let changed = alreadySelected;
    try {
      if (!alreadySelected) changed = await pi.setModel(model);
    } finally {
      switchingRoleModel = false;
    }
    if (!changed) throw new Error(\`No usable credentials for \${describeModel(target)}\`);`;
if (source.includes(oldSelection)) source = source.replace(oldSelection, newSelection);

if (source.includes("pi.setActiveTools(")) throw new Error("Cascade still replaces Pi active tools");
for (const command of ["model", "login", "settings"]) {
  if (source.includes(`registerCommand(\"${command}\"`) || source.includes(`registerCommand('${command}'`)) {
    throw new Error(`Cascade shadows Pi /${command}`);
  }
}
if (!source.includes('registerCommand("cascade-setup"')) throw new Error("Missing Cascade setup command");
await writeFile(path, source, "utf8");

const smokePath = "scripts/tui-smoke.mjs";
let smoke = await readFile(smokePath, "utf8");
smoke = smoke.replace(
  '  await send("\\r", 700);                 // confirm save',
  '  await send("y\\r", 700);                // confirm save'
);
await writeFile(smokePath, smoke, "utf8");

console.log("Cascade Pi parity finalizer applied.");
