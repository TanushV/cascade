#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = "tests";
const files = (await readdir(root)).filter((name) => name.endsWith(".test.mjs"));
for (const name of files) {
  const path = join(root, name);
  let source = await readFile(path, "utf8");
  const original = source;

  // Existing fixtures that name a concrete model are explicit configurations,
  // not requests to inherit whatever native Pi model happens to be active.
  source = source.replace(/worker:\s*\{\s*(?!useNativeModel:)(?=provider:)/g, "worker: { useNativeModel: false, ");
  source = source.replace(/expert:\s*\{\s*(?!useNativeModel:)(?=provider:)/g, "expert: { useNativeModel: false, ");
  source = source.replace(/"worker":\s*\{\s*(?!"useNativeModel")(?="provider")/g, '"worker": { "useNativeModel": false, ');
  source = source.replace(/"expert":\s*\{\s*(?!"useNativeModel")(?="provider")/g, '"expert": { "useNativeModel": false, ');

  // The old single-mode regression test asserted the wrapper's side effects.
  // Those assertions are now invalid: native Pi startup must retain its model
  // and active tools. Dedicated parity tests cover the stronger invariant.
  const start = source.indexOf('test("extension initializes single-model worker and records route evidence"');
  if (start >= 0) {
    const next = source.indexOf('\ntest("', start + 10);
    const end = next >= 0 ? next : source.length;
    let block = source.slice(start, end);
    block = block.replace(/^\s*assert\.[^\n]*(?:setModel|activeTools|setActiveTools)[^\n]*\n/gm, "");
    source = `${source.slice(0, start)}${block}${source.slice(end)}`;
  }

  if (source !== original) await writeFile(path, source, "utf8");
}
console.log("Parity test fixtures migrated to explicit model semantics.");
