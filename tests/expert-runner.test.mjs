import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { parseExpertJson, runExpertEpisode } from "../extension/core/expert-runner.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("expert runner parses Pi JSON event stream and exact model args", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-expert-"));
  const fake = join(dir, "fake-pi.mjs");
  const argsFile = join(dir, "args.json");
  writeFileSync(fake, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FAKE_ARGS, JSON.stringify(process.argv.slice(2)));\nconst response = {decision:'continue-worker',summary:'Use the verified invariant',findings:[],patchConstraints:[],requiredEvidence:[],nextAction:'run the target test',risks:[],confidence:0.9};\nconsole.log(JSON.stringify({type:'session',version:3,id:'x'}));\nconsole.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify(response)}],usage:{input:1000,output:200,cost:{total:0.01}}}}));\n`, "utf8");
  chmodSync(fake, 0o755);
  const config = deepClone(DEFAULT_CONFIG);
  config.piBinary = fake;
  config.mode = "dual";
  config.expert = { ...config.expert, provider: "openrouter", model: "anthropic/expert", tools: ["read", "edit", "write"], timeoutMs: 5000 };
  process.env.FAKE_ARGS = argsFile;
  const result = await runExpertEpisode({
    config,
    cwd: dir,
    question: "Resolve this",
    evidenceJson: "{}",
    extensionPath: "/tmp/cascade-extension.mjs",
    mode: "consult"
  });
  assert.equal(result.parsed.decision, "continue-worker");
  assert.equal(result.estimatedCostUsd, 0.01);
  const args = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.deepEqual(args.slice(args.indexOf("--provider"), args.indexOf("--provider") + 4), ["--provider", "openrouter", "--model", "anthropic/expert"]);
  const tools = args[args.indexOf("--tools") + 1];
  assert.equal(tools.includes("edit"), false);
  assert.ok(args.includes("/tmp/cascade-extension.mjs"));
  delete process.env.FAKE_ARGS;
});

test("expert JSON parser falls back safely", () => {
  const parsed = parseExpertJson("not json at all");
  assert.equal(parsed.decision, "redirect-worker");
  assert.equal(parsed.confidence, 0);
});

test("explicit takeover retains configured edit and write tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-takeover-"));
  const fake = join(dir, "fake-pi.mjs");
  const argsFile = join(dir, "args.json");
  writeFileSync(fake, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FAKE_ARGS, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify({decision:'continue-worker',summary:'done',findings:[],patchConstraints:[],requiredEvidence:[],nextAction:'verify',risks:[],confidence:1})}],usage:{input:1,output:1}}}));\n`, "utf8");
  chmodSync(fake, 0o755);
  const config = deepClone(DEFAULT_CONFIG);
  config.piBinary = fake;
  config.mode = "dual";
  config.expert = { ...config.expert, provider: "openrouter", model: "expert", tools: ["read", "bash", "edit", "write"], timeoutMs: 5000 };
  process.env.FAKE_ARGS = argsFile;
  await runExpertEpisode({ config, cwd: dir, question: "take over", evidenceJson: "{}", mode: "takeover" });
  const args = JSON.parse(readFileSync(argsFile, "utf8"));
  const tools = args[args.indexOf("--tools") + 1].split(",");
  assert.ok(tools.includes("edit"));
  assert.ok(tools.includes("write"));
  delete process.env.FAKE_ARGS;
});

test("expert runner consumes a final JSON event without trailing newline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-expert-no-newline-"));
  const fake = join(dir, "fake-pi.mjs");
  writeFileSync(fake, `#!/usr/bin/env node\nconst response = {decision:'continue-worker',summary:'final fragment parsed',findings:[],patchConstraints:[],requiredEvidence:[],nextAction:'verify',risks:[],confidence:1};\nprocess.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify(response)}],usage:{input:1,output:1}}}));\n`, "utf8");
  chmodSync(fake, 0o755);
  const config = deepClone(DEFAULT_CONFIG);
  config.piBinary = fake;
  config.mode = "dual";
  config.expert = { ...config.expert, provider: "openrouter", model: "expert", timeoutMs: 5000 };
  const result = await runExpertEpisode({ config, cwd: dir, question: "parse", evidenceJson: "{}" });
  assert.equal(result.parsed.summary, "final fragment parsed");
});
