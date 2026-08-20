#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  console.log(`Cascade TUI smoke skipped on ${process.platform}; Linux PTY coverage runs in CI.`);
  process.exit(0);
}
if (spawnSync("script", ["--version"], { stdio: "ignore" }).error) {
  console.log("Cascade TUI smoke skipped because util-linux script(1) is unavailable.");
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "cascade.mjs");
const workspace = mkdtempSync(join(tmpdir(), "cascade-real-tui-"));
const home = join(workspace, "home");
const project = join(workspace, "project");
mkdirSync(join(project, ".cascade"), { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(project, "README.md"), "# TUI smoke\n", "utf8");
writeFileSync(join(project, ".cascade", "config.json"), `${JSON.stringify({
  schemaVersion: 1,
  mode: "single",
  worker: {
    useNativeModel: false,
    provider: "meta-model-api",
    model: "muse-spark-1.2",
    thinking: "medium"
  },
  expert: {
    useNativeModel: false,
    provider: "meta-model-api",
    model: "muse-spark-1.2",
    thinking: "high",
    tools: ["read", "grep", "find", "ls", "bash"]
  },
  routing: { autoConsult: false },
  privacy: { classification: "internal", allowContributor: false }
}, null, 2)}\n`, "utf8");

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const command = `${quote(process.execPath)} ${quote(cli)} --no-session`;
const child = spawn("script", ["-qefc", command, "/dev/null"], {
  cwd: project,
  env: {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    MODEL_API_KEY: "cascade-tui-smoke-key",
    CASCADE_PROJECT_TRUSTED: "1",
    TERM: "xterm-256color",
    CI: ""
  },
  stdio: ["pipe", "pipe", "pipe"]
});

let output = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const send = async (value, wait = 350) => {
  child.stdin.write(value);
  await delay(wait);
};

let timeout;
try {
  timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
  await delay(1800);

  // Prove native Pi menus remain reachable. Cascade must not shadow these.
  await send("/settings\r", 500);
  await send("\u001b", 300);
  await send("/model\r", 500);
  await send("\u001b", 300);
  await send("/login\r", 500);
  await send("\u001b", 300);

  // Complete the actual Cascade TUI setup: project scope, dual mode,
  // current worker/expert models, auto consultation, internal privacy, save.
  await send("/cascade-setup\r", 500);
  await send("\r", 300);                 // project scope
  await send("\u001b[B\r", 300);        // dual mode
  await send("\r", 300);                 // current Pi worker model
  await send("\r", 300);                 // keep worker thinking
  await send("\r", 300);                 // current Pi expert model
  await send("\r", 300);                 // keep expert thinking
  await send("\u001b[B\r", 300);        // enable auto consultation
  await send("\u001b[B\u001b[B\r", 300); // internal privacy
  await send("\r", 700);                 // confirm save

  await send("/cascade-role expert\r", 600);
  await send("/cascade-role worker\r", 600);
  await send("/settings\r", 500);
  await send("\u001b", 300);
  await send("\u0003", 500);
  await send("\u0003", 200);

  const exit = await Promise.race([
    new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal }))),
    delay(3000).then(() => ({ code: null, signal: "timeout" }))
  ]);
  if (exit.signal === "timeout") child.kill("SIGKILL");

  const configPath = join(project, ".cascade", "config.json");
  if (!existsSync(configPath)) throw new Error("TUI setup did not save .cascade/config.json");
  const saved = JSON.parse(readFileSync(configPath, "utf8"));
  if (saved.mode !== "dual") throw new Error(`TUI setup did not enable dual mode: ${saved.mode}`);
  if (!saved.worker?.provider || !saved.worker?.model) throw new Error("TUI setup did not persist the worker model");
  if (!saved.expert?.provider || !saved.expert?.model) throw new Error("TUI setup did not persist the expert model");
  if (saved.routing?.autoConsult !== true) throw new Error("TUI setup did not enable automatic expert consultation");
  if (saved.privacy?.classification !== "internal") throw new Error("TUI setup did not persist repository privacy");

  const plain = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
  if (/TypeError|ReferenceError|SyntaxError|Unhandled|ERR_/.test(plain)) {
    throw new Error(`TUI emitted a runtime error:\n${plain.slice(-5000)}`);
  }
  for (const commandName of ["/settings", "/model", "/login", "/cascade-setup"]) {
    if (!plain.includes(commandName)) throw new Error(`TUI transcript did not contain ${commandName}`);
  }
  console.log("Real Cascade TUI smoke passed: native Pi menus, dual setup save, and role switching.");
} finally {
  clearTimeout(timeout);
  if (!child.killed) child.kill("SIGKILL");
  if (process.env.CASCADE_TUI_SMOKE_KEEP !== "1") rmSync(workspace, { recursive: true, force: true });
  else console.log(`TUI smoke workspace retained at ${workspace}`);
}
