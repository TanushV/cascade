import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { atomicWriteJson, safeFileName, shortHash, truncateText } from "./util.mjs";

function workspaceStatePath({ cwd, config, sessionId }) {
  if (config.workspaceRuntime.statePath) return resolve(cwd, config.workspaceRuntime.statePath);
  const root = process.env.CASCADE_STATE_DIR
    ? resolve(process.env.CASCADE_STATE_DIR)
    : join(homedir(), ".local", "state", "cascade");
  return join(root, "workspaces", shortHash(resolve(cwd), 20), `${safeFileName(sessionId || "ephemeral", shortHash(sessionId || "ephemeral", 24))}.json`);
}

function loadState(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function buildWrapper({ code, input, state }) {
  return `import json, math, statistics, re, collections, itertools, functools\n\nSAFE_BUILTINS = {\n    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,\n    "enumerate": enumerate, "filter": filter, "float": float, "int": int,\n    "len": len, "list": list, "map": map, "max": max, "min": min,\n    "range": range, "reversed": reversed, "round": round, "set": set,\n    "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "zip": zip,\n    "Exception": Exception, "ValueError": ValueError, "TypeError": TypeError,\n}\nnamespace = {\n    "__builtins__": SAFE_BUILTINS,\n    "json": json, "math": math, "statistics": statistics, "re": re,\n    "collections": collections, "itertools": itertools, "functools": functools,\n    "state": json.loads(${JSON.stringify(JSON.stringify(state))}),\n    "input": json.loads(${JSON.stringify(JSON.stringify(input))}),\n    "result": None,\n}\ncode = ${JSON.stringify(code)}\ntry:\n    exec(compile(code, "<cascade-workspace>", "exec"), namespace, namespace)\n    payload = {"ok": True, "result": namespace.get("result"), "state": namespace.get("state", {})}\nexcept Exception as exc:\n    payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "state": namespace.get("state", {})}\nprint(json.dumps(payload, ensure_ascii=False, default=str))\n`;
}

function commandFor(config, scriptPath, cwd) {
  const python = config.workspaceRuntime.pythonBinary || "python3";
  const template = Array.isArray(config.workspaceRuntime.sandboxCommand)
    ? config.workspaceRuntime.sandboxCommand.map(String)
    : [];
  if (template.length === 0) {
    if (!config.workspaceRuntime.allowUnsandboxed) {
      throw new Error("workspace runtime requires workspaceRuntime.sandboxCommand, or an explicit allowUnsandboxed=true acknowledgement");
    }
    return { executable: python, args: ["-I", "-u", scriptPath], sandboxed: false };
  }
  const replace = (value) => value
    .replaceAll("{python}", python)
    .replaceAll("{script}", scriptPath)
    .replaceAll("{cwd}", cwd);
  const expanded = template.map(replace);
  return { executable: expanded[0], args: expanded.slice(1), sandboxed: true };
}

export async function runProgrammaticWorkspace({ code, input = {}, reset = false, cwd, config, sessionId, signal }) {
  if (!config.workspaceRuntime?.enabled) throw new Error("workspace runtime is disabled");
  const source = String(code || "");
  if (!source.trim()) throw new Error("workspace code is required");
  if (source.length > Number(config.workspaceRuntime.maxCodeCharacters || 20000)) {
    throw new Error("workspace code exceeds the configured size limit");
  }
  const statePath = workspaceStatePath({ cwd, config, sessionId });
  const state = reset ? {} : loadState(statePath);
  const temporary = mkdtempSync(join(tmpdir(), "cascade-workspace-"));
  const scriptPath = join(temporary, "run.py");
  writeFileSync(scriptPath, buildWrapper({ code: source, input, state }), { encoding: "utf8", mode: 0o600 });
  const command = commandFor(config, scriptPath, resolve(cwd));
  const startedAt = Date.now();
  try {
    const execution = await new Promise((resolvePromise) => {
      const child = spawn(command.executable, command.args, {
        cwd,
        env: { PATH: process.env.PATH || "", LANG: process.env.LANG || "C.UTF-8" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolvePromise(value);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      }, Number(config.workspaceRuntime.timeoutMs || 120000));
      const abort = () => {
        child.kill("SIGTERM");
        settle({ ok: false, aborted: true, stdout, stderr, code: null });
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout = truncateText(`${stdout}${chunk}`, config.workspaceRuntime.maxOutputCharacters); });
      child.stderr.on("data", (chunk) => { stderr = truncateText(`${stderr}${chunk}`, config.workspaceRuntime.maxOutputCharacters); });
      child.on("error", (error) => settle({ ok: false, error: error.message, stdout, stderr, code: null }));
      child.on("close", (codeValue, childSignal) => settle({
        ok: codeValue === 0 && !timedOut,
        code: codeValue,
        signal: childSignal,
        timedOut,
        stdout,
        stderr
      }));
    });
    if (!execution.ok) {
      if (execution.aborted) throw new Error("workspace process was aborted");
      if (execution.timedOut) throw new Error(`workspace process timed out after ${config.workspaceRuntime.timeoutMs} ms`);
      throw new Error(execution.error || execution.stderr || `workspace process failed with code ${execution.code}`);
    }
    const lines = execution.stdout.trim().split("\n").filter(Boolean);
    let payload;
    try { payload = JSON.parse(lines.at(-1) || "{}"); }
    catch { throw new Error(`workspace returned invalid JSON: ${truncateText(execution.stdout, 2000)}`); }
    if (!payload.ok) throw new Error(payload.error || "workspace code failed");
    const stateJson = JSON.stringify(payload.state ?? {});
    if (stateJson.length > Number(config.workspaceRuntime.maxStateCharacters || 200000)) {
      throw new Error("workspace state exceeds the configured size limit");
    }
    mkdirSync(dirname(statePath), { recursive: true });
    atomicWriteJson(statePath, payload.state ?? {}, 0o600);
    return {
      ok: true,
      result: payload.result,
      statePath,
      stateCharacters: stateJson.length,
      durationMs: Date.now() - startedAt,
      sandboxed: command.sandboxed
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
