#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  console.log(`Cascade real TUI smoke skipped on ${process.platform}; Linux PTY coverage runs in CI.`);
  process.exit(0);
}
if (spawnSync("script", ["--version"], { stdio: "ignore" }).error) {
  console.log("Cascade real TUI smoke skipped because util-linux script(1) is unavailable.");
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "cascade.mjs");
const workspace = mkdtempSync(join(tmpdir(), "cascade-native-tui-"));
const home = join(workspace, "home");
const project = join(workspace, "project");
mkdirSync(join(project, ".cascade"), { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(project, "README.md"), "# Cascade native TUI smoke\n", "utf8");
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
const send = async (value, wait = 450) => {
  child.stdin.write(value);
  await delay(wait);
};

let timeout;
try {
  timeout = setTimeout(() => child.kill("SIGKILL"), 25000);
  await delay(1800);

  // Exercise actual Pi commands through a real pseudo-terminal. Escape closes
  // each native menu without altering credentials or user settings.
  await send("/settings\r", 650);
  await send("\u001b", 350);
  await send("/model\r", 650);
  await send("\u001b", 350);
  await send("/login\r", 650);
  await send("\u001b", 350);
  await send("/cascade-setup\r", 650);
  await send("\u001b", 350);
  await send("/cascade\r", 500);
  await send("\u0003", 400);
  await send("\u0003", 200);

  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(2500)
  ]);
  if (!child.killed) child.kill("SIGKILL");

  const plain = output
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
  if (/TypeError|ReferenceError|SyntaxError|Unhandled|ERR_MODULE|ERR_INVALID/.test(plain)) {
    throw new Error(`Cascade TUI emitted a runtime error:\n${plain.slice(-5000)}`);
  }
  for (const commandName of ["/settings", "/model", "/login", "/cascade-setup", "/cascade"]) {
    if (!plain.includes(commandName)) throw new Error(`Cascade TUI transcript did not contain ${commandName}`);
  }
  console.log("Real Cascade TUI smoke passed: native Pi settings/model/login and Cascade setup remained reachable.");
} finally {
  clearTimeout(timeout);
  if (!child.killed) child.kill("SIGKILL");
  if (process.env.CASCADE_TUI_SMOKE_KEEP !== "1") rmSync(workspace, { recursive: true, force: true });
  else console.log(`Cascade TUI smoke workspace retained at ${workspace}`);
}
