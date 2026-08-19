import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { probeModelProfile } from "../extension/core/probe.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("model capability probe validates provider stream and tool execution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-probe-"));
  const fake = join(dir, "fake-pi.mjs");
  writeFileSync(fake, `#!/usr/bin/env node\nconsole.log(JSON.stringify({type:'message_start',message:{role:'assistant'}}));\nconsole.log(JSON.stringify({type:'tool_execution_start',toolName:'cascade_probe_echo'}));\nconsole.log(JSON.stringify({type:'tool_execution_end',toolName:'cascade_probe_echo',isError:false}));\nconsole.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'CASCADE_PROBE_OK'}],usage:{input:1,output:1}}}));\n`, "utf8");
  chmodSync(fake, 0o755);
  const config = deepClone(DEFAULT_CONFIG);
  config.mode = "single";
  config.piBinary = fake;
  const report = await probeModelProfile({
    config,
    profile: { provider: "openrouter", model: "test", thinking: "low" },
    cwd: dir,
    extensionPath: "/tmp/cascade.mjs",
    probeExtensionPath: "/tmp/probe.mjs",
    timeoutMs: 5000
  });
  assert.equal(report.ok, true);
  assert.equal(report.state.toolCompleted, true);
});

test("model capability probe consumes a final event without trailing newline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-probe-no-newline-"));
  const fake = join(dir, "fake-pi.mjs");
  writeFileSync(fake, `#!/usr/bin/env node\nconsole.log(JSON.stringify({type:'message_start',message:{role:'assistant'}}));\nconsole.log(JSON.stringify({type:'tool_execution_start',toolName:'cascade_probe_echo'}));\nconsole.log(JSON.stringify({type:'tool_execution_end',toolName:'cascade_probe_echo',isError:false}));\nprocess.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'CASCADE_PROBE_OK'}],usage:{input:1,output:1}}}));\n`, "utf8");
  chmodSync(fake, 0o755);
  const config = deepClone(DEFAULT_CONFIG);
  config.mode = "single";
  config.piBinary = fake;
  const report = await probeModelProfile({
    config,
    profile: { provider: "openrouter", model: "test", thinking: "low" },
    cwd: dir,
    extensionPath: "/tmp/cascade.mjs",
    probeExtensionPath: "/tmp/probe.mjs",
    timeoutMs: 5000
  });
  assert.equal(report.ok, true);
  assert.equal(report.state.finalText, "CASCADE_PROBE_OK");
});
