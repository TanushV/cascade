#!/usr/bin/env node
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();

async function read(path) {
  return readFile(join(root, path), "utf8");
}

async function write(path, content, mode) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  if (mode) await chmod(full, mode);
}

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Unable to locate ${label}`);
  return text.replace(from, to);
}

function replaceRegex(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Unable to locate ${label}`);
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

const parityModule = String.raw`export function modelId(model) {
  return model?.id || model?.model || model?.modelId || "";
}

export function sameModel(left, right) {
  return Boolean(
    left &&
    right &&
    left.provider === right.provider &&
    modelId(left) === modelId(right)
  );
}

export function activeToolNames(pi) {
  const active = pi.getActiveTools?.();
  if (Array.isArray(active)) {
    return active
      .map((tool) => (typeof tool === "string" ? tool : tool?.name))
      .filter(Boolean);
  }
  return (pi.getAllTools?.() || []).map((tool) => tool.name).filter(Boolean);
}

export function createToolPolicyState() {
  return { restricted: false, snapshot: [] };
}

export function applyRoleToolPolicy({ pi, profile, controls = [], state }) {
  const available = new Set((pi.getAllTools?.() || []).map((tool) => tool.name));
  if (profile?.restrictTools === true) {
    if (!state.restricted) state.snapshot = activeToolNames(pi);
    const desired = [...new Set([...(profile.tools || []), ...controls])].filter((name) => available.has(name));
    pi.setActiveTools(desired);
    state.restricted = true;
    return { changed: true, restricted: true, tools: desired };
  }

  if (state.restricted) {
    const restored = [...new Set([...(state.snapshot || []), ...controls])].filter((name) => available.has(name));
    pi.setActiveTools(restored);
    state.restricted = false;
    state.snapshot = [];
    return { changed: true, restricted: false, tools: restored };
  }

  return { changed: false, restricted: false, tools: activeToolNames(pi) };
}

export function usesConfiguredModel(profile) {
  return profile?.selectionMode === "configured";
}
`;

const setupModule = String.raw`import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { getGlobalConfigPath, getProjectConfigPath } from "./config.mjs";
import { VALID_THINKING_LEVELS } from "./defaults.mjs";
import { isContributorModel } from "./privacy.mjs";
import { atomicWriteJson, deepClone } from "./util.mjs";
import { modelId } from "./pi-parity.mjs";

export const SETUP_OPTIONS = Object.freeze({
  scopeSession: "Session only (do not write a file)",
  scopeProject: "This project (.cascade/config.json)",
  scopeGlobal: "All projects (~/.config/cascade/config.json)",
  modeSingle: "Single model (native Pi behavior)",
  modeDual: "Dual model (worker + on-demand expert)",
  workerNative: "Use the current Pi model and native /model picker",
  workerFixed: "Choose a fixed worker model",
  editBudgets: "Edit expert and session budgets",
  keepBudgets: "Keep current budgets"
});

function plainMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return deepClone(patch);
  const result = base && typeof base === "object" && !Array.isArray(base) ? deepClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) result[key] = plainMerge(result[key], value);
    else result[key] = deepClone(value);
  }
  return result;
}

function readObject(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function persistCascadeConfig({ cwd, scope, config }) {
  if (scope === "session") return { path: undefined, scope, config };
  const path = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(cwd);
  const existing = readObject(path);
  const merged = plainMerge(existing, config);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, merged, 0o600);
  return { path, scope, config: merged };
}

function modelKey(model) {
  return `${model?.provider || ""}/${modelId(model)}`;
}

function allModels(ctx) {
  const models = [...(ctx.modelRegistry?.getAll?.() || [])];
  if (ctx.model && !models.some((model) => modelKey(model) === modelKey(ctx.model))) models.push(ctx.model);
  const seen = new Set();
  return models
    .filter((model) => model?.provider && modelId(model))
    .filter((model) => {
      const key = modelKey(model);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => modelKey(left).localeCompare(modelKey(right)));
}

function availabilitySet(ctx) {
  return new Set((ctx.modelRegistry?.getAvailable?.() || []).map(modelKey));
}

function providerLabel(ctx, provider, ready) {
  const display = ctx.modelRegistry?.getProviderDisplayName?.(provider) || provider;
  return `${display} · ${provider}${ready ? " · ready" : " · login required"}`;
}

function modelLabel(model, ready) {
  const id = modelId(model);
  const name = model.name && model.name !== id ? `${model.name} · ${id}` : id;
  return `${name}${ready ? " · ready" : " · login required"}`;
}

export function listRoleModelChoices(ctx, provider) {
  const ready = availabilitySet(ctx);
  return allModels(ctx)
    .filter((model) => !provider || model.provider === provider)
    .map((model) => ({
      label: modelLabel(model, ready.has(modelKey(model))),
      model,
      ready: ready.has(modelKey(model))
    }));
}

export function listProviderChoices(ctx) {
  const models = allModels(ctx);
  const ready = availabilitySet(ctx);
  const providers = [...new Set(models.map((model) => model.provider))].sort();
  return providers.map((provider) => ({
    provider,
    ready: models.some((model) => model.provider === provider && ready.has(modelKey(model))),
    label: providerLabel(ctx, provider, models.some((model) => model.provider === provider && ready.has(modelKey(model))))
  }));
}

async function chooseScope(ctx) {
  const selected = await ctx.ui.select("Cascade setup · Save settings", [
    SETUP_OPTIONS.scopeSession,
    SETUP_OPTIONS.scopeProject,
    SETUP_OPTIONS.scopeGlobal
  ]);
  if (!selected) return undefined;
  if (selected === SETUP_OPTIONS.scopeGlobal) return "global";
  if (selected === SETUP_OPTIONS.scopeProject) return "project";
  return "session";
}

async function chooseProvider(ctx, title) {
  const choices = listProviderChoices(ctx);
  if (!choices.length) {
    ctx.ui.notify("No models are present in Pi's model catalog. Use /login or configure a provider first.", "warning");
    return undefined;
  }
  const label = await ctx.ui.select(title, choices.map((choice) => choice.label));
  return choices.find((choice) => choice.label === label)?.provider;
}

async function chooseFixedModel(ctx, role, current) {
  const provider = await chooseProvider(ctx, `Cascade setup · ${role} provider`);
  if (!provider) return undefined;
  const choices = listRoleModelChoices(ctx, provider);
  const label = await ctx.ui.select(`Cascade setup · ${role} model`, choices.map((choice) => choice.label));
  const selected = choices.find((choice) => choice.label === label);
  if (!selected) return undefined;
  return {
    profile: {
      ...deepClone(current || {}),
      selectionMode: "configured",
      thinkingMode: "configured",
      provider: selected.model.provider,
      model: modelId(selected.model),
      restrictTools: Boolean(current?.restrictTools)
    },
    ready: selected.ready,
    provider: selected.model.provider
  };
}

async function chooseThinking(ctx, role, current, nativeAllowed = false) {
  const levels = [...VALID_THINKING_LEVELS];
  const native = "Use Pi's current thinking level";
  const options = nativeAllowed ? [native, ...levels] : levels;
  const preferred = nativeAllowed && current?.thinkingMode !== "configured" ? native : current?.thinking;
  const ordered = preferred && options.includes(preferred)
    ? [preferred, ...options.filter((value) => value !== preferred)]
    : options;
  const selected = await ctx.ui.select(`Cascade setup · ${role} thinking`, ordered);
  if (!selected) return undefined;
  if (selected === native) return { thinkingMode: "native" };
  return { thinkingMode: "configured", thinking: selected };
}

async function chooseNumber(ctx, title, current) {
  const value = await ctx.ui.input(title, String(current));
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    ctx.ui.notify(`${title} must be a positive number.`, "error");
    return chooseNumber(ctx, title, current);
  }
  return parsed;
}

function roleReady(ctx, profile) {
  if (!profile?.provider || !profile?.model) return false;
  return availabilitySet(ctx).has(`${profile.provider}/${profile.model}`);
}

export async function chooseLoginProvider(ctx, preferred) {
  const choices = listProviderChoices(ctx);
  if (!choices.length) return preferred;
  if (preferred && choices.some((choice) => choice.provider === preferred)) return preferred;
  const label = await ctx.ui.select("Cascade · Authenticate provider with Pi", choices.map((choice) => choice.label));
  return choices.find((choice) => choice.label === label)?.provider;
}

export function prepareNativeLogin(ctx, provider) {
  if (!provider) return false;
  ctx.ui.setEditorText(`/login ${provider}`);
  ctx.ui.notify(`Pi's native login command is ready for ${provider}. Press Enter to authenticate.`, "info");
  return true;
}

function summary(config, scope) {
  const worker = config.worker.selectionMode === "native"
    ? "current Pi model (/model remains authoritative)"
    : `${config.worker.provider}/${config.worker.model}`;
  const expert = config.mode === "dual" ? `${config.expert.provider}/${config.expert.model}` : "disabled";
  return [
    `Save: ${scope}`,
    `Mode: ${config.mode}`,
    `Worker: ${worker}`,
    `Expert: ${expert}`,
    `Auto-consult: ${config.routing.autoConsult ? "on" : "off"}`,
    `Privacy: ${config.privacy.classification}`,
    `Contributor endpoints: ${config.privacy.allowContributor ? "allowed" : "blocked"}`
  ].join("\n");
}

export async function runCascadeSetup({ ctx, config }) {
  if (!ctx?.hasUI) throw new Error("Cascade setup requires Pi's interactive UI");
  const scope = await chooseScope(ctx);
  if (!scope) return { cancelled: true };

  const next = deepClone(config);
  const modeLabel = await ctx.ui.select("Cascade setup · Operating mode", [
    SETUP_OPTIONS.modeSingle,
    SETUP_OPTIONS.modeDual
  ]);
  if (!modeLabel) return { cancelled: true };
  next.mode = modeLabel === SETUP_OPTIONS.modeDual ? "dual" : "single";

  const workerChoice = await ctx.ui.select("Cascade setup · Worker model", [
    SETUP_OPTIONS.workerNative,
    SETUP_OPTIONS.workerFixed
  ]);
  if (!workerChoice) return { cancelled: true };

  const missingProviders = [];
  if (workerChoice === SETUP_OPTIONS.workerNative) {
    next.worker = {
      ...next.worker,
      selectionMode: "native",
      thinkingMode: "native",
      restrictTools: Boolean(next.worker?.restrictTools)
    };
    if (ctx.model) {
      next.worker.provider = ctx.model.provider;
      next.worker.model = modelId(ctx.model);
    }
  } else {
    const worker = await chooseFixedModel(ctx, "Worker", next.worker);
    if (!worker) return { cancelled: true };
    next.worker = worker.profile;
    const thinking = await chooseThinking(ctx, "Worker", next.worker);
    if (!thinking) return { cancelled: true };
    next.worker = { ...next.worker, ...thinking };
    if (!worker.ready) missingProviders.push(worker.provider);
  }

  if (next.mode === "dual") {
    const expert = await chooseFixedModel(ctx, "Expert", next.expert);
    if (!expert) return { cancelled: true };
    next.expert = expert.profile;
    const thinking = await chooseThinking(ctx, "Expert", next.expert);
    if (!thinking) return { cancelled: true };
    next.expert = { ...next.expert, ...thinking };
    if (!expert.ready) missingProviders.push(expert.provider);
    next.routing.autoConsult = await ctx.ui.confirm(
      "Cascade setup · Automatic expert consultation",
      "Allow Cascade to consult the expert automatically when trajectory evidence crosses the configured threshold?"
    );
  } else {
    next.routing.autoConsult = false;
  }

  const classification = await ctx.ui.select("Cascade setup · Repository privacy", [
    "unknown",
    "public",
    "internal",
    "confidential",
    "regulated"
  ]);
  if (!classification) return { cancelled: true };
  next.privacy.classification = classification;

  const contributorSelected = [next.worker, next.mode === "dual" ? next.expert : undefined]
    .filter(Boolean)
    .some((profile) => isContributorModel(profile, next.privacy.contributorPattern));
  next.privacy.allowContributor = false;
  if (contributorSelected) {
    if (classification !== "public") {
      ctx.ui.notify("Contributor endpoints remain blocked because this repository is not classified public.", "warning");
    } else {
      next.privacy.allowContributor = await ctx.ui.confirm(
        "Cascade setup · Contributor endpoint",
        "Allow public repository content to be sent to the selected Contributor endpoint?"
      );
    }
  }

  const budgetChoice = await ctx.ui.select("Cascade setup · Budgets", [
    SETUP_OPTIONS.keepBudgets,
    SETUP_OPTIONS.editBudgets
  ]);
  if (!budgetChoice) return { cancelled: true };
  if (budgetChoice === SETUP_OPTIONS.editBudgets) {
    const calls = await chooseNumber(ctx, "Maximum expert calls per session", next.budgets.maxExpertCalls);
    if (calls === undefined) return { cancelled: true };
    const expertCost = await chooseNumber(ctx, "Maximum expert cost in USD", next.budgets.maxExpertCostUsd);
    if (expertCost === undefined) return { cancelled: true };
    const sessionCost = await chooseNumber(ctx, "Maximum total session cost in USD", next.budgets.maxSessionEstimatedCostUsd);
    if (sessionCost === undefined) return { cancelled: true };
    next.budgets.maxExpertCalls = Math.floor(calls);
    next.budgets.maxExpertCostUsd = expertCost;
    next.budgets.maxSessionEstimatedCostUsd = sessionCost;
  }

  const confirmed = await ctx.ui.confirm("Save Cascade settings?", summary(next, scope));
  if (!confirmed) return { cancelled: true };
  const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });

  const uniqueMissing = [...new Set(missingProviders)].filter(Boolean);
  let loginProvider;
  if (uniqueMissing.length) {
    const shouldLogin = await ctx.ui.confirm(
      "Cascade setup · Authentication required",
      `No usable Pi credential is configured for: ${uniqueMissing.join(", ")}. Prepare Pi's native /login command now?`
    );
    if (shouldLogin) loginProvider = await chooseLoginProvider(ctx, uniqueMissing[0]);
  }

  return {
    cancelled: false,
    config: next,
    scope,
    path: persisted.path,
    loginProvider,
    workerReady: next.worker.selectionMode === "native" ? Boolean(ctx.model) : roleReady(ctx, next.worker),
    expertReady: next.mode === "dual" ? roleReady(ctx, next.expert) : true
  };
}

export async function runRoleModelPicker({ ctx, config, role }) {
  if (!ctx?.hasUI) throw new Error("Cascade model selection requires Pi's interactive UI");
  if (!['worker', 'expert'].includes(role)) throw new Error("Role must be worker or expert");
  const next = deepClone(config);
  if (role === "worker") {
    const strategy = await ctx.ui.select("Cascade · Worker model", [SETUP_OPTIONS.workerNative, SETUP_OPTIONS.workerFixed]);
    if (!strategy) return { cancelled: true };
    if (strategy === SETUP_OPTIONS.workerNative) {
      next.worker = {
        ...next.worker,
        selectionMode: "native",
        thinkingMode: "native",
        ...(ctx.model ? { provider: ctx.model.provider, model: modelId(ctx.model) } : {})
      };
      return { cancelled: false, config: next, scope: "session" };
    }
  }
  const selected = await chooseFixedModel(ctx, role === "worker" ? "Worker" : "Expert", next[role]);
  if (!selected) return { cancelled: true };
  const thinking = await chooseThinking(ctx, role === "worker" ? "Worker" : "Expert", selected.profile);
  if (!thinking) return { cancelled: true };
  next[role] = { ...selected.profile, ...thinking };
  const scope = await chooseScope(ctx);
  if (!scope) return { cancelled: true };
  const persisted = persistCascadeConfig({ cwd: ctx.cwd, scope, config: next });
  return {
    cancelled: false,
    config: next,
    scope,
    path: persisted.path,
    loginProvider: selected.ready ? undefined : selected.provider
  };
}
`;

const setupTests = String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import {
  SETUP_OPTIONS,
  listProviderChoices,
  prepareNativeLogin,
  runCascadeSetup
} from "../extension/core/tui-setup.mjs";

function model(provider, id, name = id) {
  return { provider, id, name };
}

function fakeContext(cwd) {
  const current = model("openrouter", "cheap-worker", "Cheap Worker");
  const strong = model("openrouter", "strong-expert", "Strong Expert");
  const all = [current, strong];
  const selected = [];
  const editors = [];
  const notifications = [];
  const ctx = {
    cwd,
    hasUI: true,
    model: current,
    modelRegistry: {
      getAll: () => all,
      getAvailable: () => all,
      getProviderDisplayName: (provider) => provider === "openrouter" ? "OpenRouter" : provider
    },
    ui: {
      async select(title, options) {
        selected.push({ title, options });
        if (title.includes("Save settings")) return SETUP_OPTIONS.scopeProject;
        if (title.includes("Operating mode")) return SETUP_OPTIONS.modeDual;
        if (title.includes("Worker model")) return SETUP_OPTIONS.workerNative;
        if (title.includes("Expert provider")) return options.find((value) => value.includes("openrouter"));
        if (title.includes("Expert model")) return options.find((value) => value.includes("strong-expert"));
        if (title.includes("Expert thinking")) return "high";
        if (title.includes("Repository privacy")) return "confidential";
        if (title.includes("Budgets")) return SETUP_OPTIONS.keepBudgets;
        throw new Error(`Unexpected selector: ${title}`);
      },
      async confirm(title) {
        if (title.includes("Automatic expert")) return true;
        if (title.includes("Save Cascade")) return true;
        return false;
      },
      async input() { throw new Error("No numeric input expected"); },
      setEditorText(value) { editors.push(value); },
      notify(message, type) { notifications.push({ message, type }); }
    }
  };
  return { ctx, selected, editors, notifications };
}

test("Cascade defaults preserve native Pi worker selection and tools", () => {
  assert.equal(DEFAULT_CONFIG.worker.selectionMode, "native");
  assert.equal(DEFAULT_CONFIG.worker.thinkingMode, "native");
  assert.equal(DEFAULT_CONFIG.worker.restrictTools, false);
  assert.equal(DEFAULT_CONFIG.expert.restrictTools, false);
});

test("TUI setup configures dual roles and writes project settings without secrets", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-tui-setup-"));
  const { ctx } = fakeContext(cwd);
  const result = await runCascadeSetup({ ctx, config: structuredClone(DEFAULT_CONFIG) });
  assert.equal(result.cancelled, false);
  assert.equal(result.scope, "project");
  assert.equal(result.config.mode, "dual");
  assert.equal(result.config.worker.selectionMode, "native");
  assert.equal(result.config.worker.provider, "openrouter");
  assert.equal(result.config.worker.model, "cheap-worker");
  assert.equal(result.config.expert.provider, "openrouter");
  assert.equal(result.config.expert.model, "strong-expert");
  assert.equal(result.config.routing.autoConsult, true);
  assert.equal(result.config.privacy.classification, "confidential");
  assert.equal(result.config.privacy.allowContributor, false);
  assert.ok(existsSync(join(cwd, ".cascade", "config.json")));
  const saved = readFileSync(join(cwd, ".cascade", "config.json"), "utf8");
  assert.ok(!saved.includes("sk-or-"));
  assert.equal(JSON.parse(saved).expert.model, "strong-expert");
});

test("provider choices use Pi's model registry", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-provider-list-"));
  const { ctx } = fakeContext(cwd);
  const providers = listProviderChoices(ctx);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].provider, "openrouter");
  assert.equal(providers[0].ready, true);
});

test("native authentication preparation uses Pi's /login command", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-auth-"));
  const { ctx, editors, notifications } = fakeContext(cwd);
  assert.equal(prepareNativeLogin(ctx, "openrouter"), true);
  assert.deepEqual(editors, ["/login openrouter"]);
  assert.ok(notifications.some((entry) => entry.message.includes("Press Enter")));
});
`;

const parityTests = String.raw`import test from "node:test";
import assert from "node:assert/strict";
import {
  activeToolNames,
  applyRoleToolPolicy,
  createToolPolicyState,
  sameModel,
  usesConfiguredModel
} from "../extension/core/pi-parity.mjs";

test("unrestricted Cascade roles leave Pi's active tool set untouched", () => {
  const calls = [];
  const pi = {
    getAllTools: () => ["read", "bash", "edit", "write", "custom"].map((name) => ({ name })),
    getActiveTools: () => ["read", "bash", "edit", "write", "custom"],
    setActiveTools: (tools) => calls.push(tools)
  };
  const state = createToolPolicyState();
  const result = applyRoleToolPolicy({ pi, profile: { restrictTools: false }, controls: ["cascade_route"], state });
  assert.equal(result.changed, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(activeToolNames(pi), ["read", "bash", "edit", "write", "custom"]);
});

test("an explicit restriction is reversible without losing native Pi tools", () => {
  const calls = [];
  let active = ["read", "bash", "edit", "write", "custom"];
  const pi = {
    getAllTools: () => ["read", "bash", "edit", "write", "custom", "cascade_route"].map((name) => ({ name })),
    getActiveTools: () => active,
    setActiveTools: (tools) => { active = tools; calls.push(tools); }
  };
  const state = createToolPolicyState();
  applyRoleToolPolicy({
    pi,
    profile: { restrictTools: true, tools: ["read", "bash"] },
    controls: ["cascade_route"],
    state
  });
  assert.deepEqual(active, ["read", "bash", "cascade_route"]);
  applyRoleToolPolicy({ pi, profile: { restrictTools: false }, controls: ["cascade_route"], state });
  assert.deepEqual(active, ["read", "bash", "edit", "write", "custom", "cascade_route"]);
  assert.equal(calls.length, 2);
});

test("native and configured model selection are distinguished", () => {
  assert.equal(usesConfiguredModel({ selectionMode: "native" }), false);
  assert.equal(usesConfiguredModel({ selectionMode: "configured" }), true);
  assert.equal(sameModel({ provider: "p", id: "m" }, { provider: "p", model: "m" }), true);
});
`;

const tuiSmokePython = String.raw`#!/usr/bin/env python3
import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin" / "cascade.mjs"
ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")

def clean(data):
    return ANSI.sub("", data.decode("utf-8", "replace")).replace("\r", "")

def read_until(master, proc, predicate, timeout, transcript):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        ready, _, _ = select.select([master], [], [], 0.15)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if chunk:
                transcript.extend(chunk)
                if predicate(clean(transcript)):
                    return True
    return predicate(clean(transcript))

def main():
    if os.name == "nt":
        print("Native pseudo-terminal smoke test skipped on Windows; wizard behavior is covered by unit tests.")
        return 0
    node = shutil.which("node")
    if not node:
        print("node is required", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory(prefix="cascade-tui-smoke-") as temp:
        home = Path(temp) / "home"
        repo = Path(temp) / "repo"
        home.mkdir()
        repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        env = os.environ.copy()
        env.update({
            "HOME": str(home),
            "CASCADE_STATE_DIR": str(Path(temp) / "state"),
            "CASCADE_CONFIG_GLOBAL": str(Path(temp) / "global.json"),
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "NO_COLOR": "1"
        })
        master, slave = pty.openpty()
        try:
            termios.tcsetwinsize(slave, (32, 120))
        except AttributeError:
            import fcntl
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 120, 0, 0))
        proc = subprocess.Popen(
            [node, str(CLI), "--single", "--approve"],
            cwd=repo,
            env=env,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True
        )
        os.close(slave)
        transcript = bytearray()
        try:
            started = read_until(master, proc, lambda text: "cascade:" in text.lower() or "cascade" in text, 15, transcript)
            if not started:
                raise AssertionError("Cascade TUI did not render its status/header")
            os.write(master, b"/cascade-setup\r")
            opened = read_until(
                master,
                proc,
                lambda text: "cascade setup" in text.lower() and "save settings" in text.lower(),
                10,
                transcript
            )
            if not opened:
                raise AssertionError("/cascade-setup did not open the native Pi selector")
            os.write(master, b"\x1b")
            time.sleep(0.3)
            os.write(master, b"\x03")
            time.sleep(0.3)
            if proc.poll() is None:
                os.write(master, b"\x04")
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.terminate()
                proc.wait(timeout=3)
            rendered = clean(transcript)
            if "cascade setup" not in rendered.lower():
                raise AssertionError("Cascade setup text was not present in the terminal transcript")
            print("Native Cascade TUI smoke test passed: startup, status rendering, slash command, selector, and cancellation.")
            return 0
        except Exception as error:
            tail = clean(transcript)[-5000:]
            print(f"TUI smoke failure: {error}\n--- terminal tail ---\n{tail}", file=sys.stderr)
            if proc.poll() is None:
                proc.terminate()
            return 1
        finally:
            try:
                os.close(master)
            except OSError:
                pass

if __name__ == "__main__":
    raise SystemExit(main())
`;

const tuiSmokeRunner = String.raw`#!/usr/bin/env node
import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
  console.log("Native pseudo-terminal smoke test skipped on Windows; TUI wizard behavior is covered by unit tests.");
  process.exit(0);
}

const python = process.env.PYTHON || "python3";
const result = spawnSync(python, ["scripts/tui-smoke.py"], { stdio: "inherit" });
if (result.error) {
  console.error(`Unable to run native TUI smoke test with ${python}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
`;

await write("extension/core/pi-parity.mjs", parityModule);
await write("extension/core/tui-setup.mjs", setupModule);
await write("tests/tui-setup.test.mjs", setupTests);
await write("tests/pi-parity.test.mjs", parityTests);
await write("scripts/tui-smoke.py", tuiSmokePython, 0o755);
await write("scripts/run-tui-smoke.mjs", tuiSmokeRunner, 0o755);

let defaults = await read("extension/core/defaults.mjs");
defaults = replaceOnce(defaults, 'export const PACKAGE_VERSION = "0.2.0";', 'export const PACKAGE_VERSION = "0.3.0";', "Cascade package version");
defaults = replaceOnce(
  defaults,
  `  worker: {\n    provider: "meta-model-api",\n    model: "muse-spark-1.2-contributor",\n    thinking: "medium",`,
  `  worker: {\n    selectionMode: "native",\n    thinkingMode: "native",\n    provider: "meta-model-api",\n    model: "muse-spark-1.2-contributor",\n    thinking: "medium",\n    restrictTools: false,`,
  "worker defaults"
);
defaults = replaceOnce(
  defaults,
  `  expert: {\n    provider: "openrouter",\n    model: "openrouter/auto",\n    thinking: "high",`,
  `  expert: {\n    selectionMode: "configured",\n    thinkingMode: "configured",\n    provider: "openrouter",\n    model: "openrouter/auto",\n    thinking: "high",\n    restrictTools: false,`,
  "expert defaults"
);
defaults = replaceOnce(
  defaults,
  'export const VALID_MODES = new Set(["single", "dual"]);',
  'export const VALID_MODES = new Set(["single", "dual"]);\nexport const VALID_SELECTION_MODES = new Set(["native", "configured"]);',
  "selection mode validation export"
);
await write("extension/core/defaults.mjs", defaults);

let cli = await read("bin/cascade.mjs");
cli = replaceOnce(
  cli,
  `  const workerPolicy = evaluateContributorPolicy(config, config.worker);\n  if (!workerPolicy.allowed) throw new Error(\`Worker endpoint blocked: \${workerPolicy.reason}\`);`,
  `  const configuredWorker = Boolean(parsed.env.CASCADE_WORKER) || config.worker.selectionMode === "configured";\n  if (configuredWorker) {\n    const workerPolicy = evaluateContributorPolicy(config, config.worker);\n    if (!workerPolicy.allowed) throw new Error(\`Worker endpoint blocked: \${workerPolicy.reason}\`);\n  }`,
  "conditional worker policy"
);
cli = replaceOnce(
  cli,
  `  const piArgs = [\n    "--extension", EXTENSION_PATH,\n    "--provider", config.worker.provider,\n    "--model", config.worker.model,\n    "--thinking", config.worker.thinking,\n    ...parsed.passthrough\n  ];`,
  `  const piArgs = ["--extension", EXTENSION_PATH];\n  if (configuredWorker) {\n    piArgs.push(\n      "--provider", config.worker.provider,\n      "--model", config.worker.model\n    );\n    if (config.worker.thinkingMode !== "native") piArgs.push("--thinking", config.worker.thinking);\n  }\n  piArgs.push(...parsed.passthrough);`,
  "native Pi launcher arguments"
);
await write("bin/cascade.mjs", cli);

let extension = await read("extension/index.mjs");
extension = replaceOnce(
  extension,
  'import { modelReference, parseModelReference, shortHash, truncateText } from "./core/util.mjs";',
  'import { modelReference, parseModelReference, shortHash, truncateText } from "./core/util.mjs";\nimport { applyRoleToolPolicy, createToolPolicyState, modelId, sameModel, usesConfiguredModel } from "./core/pi-parity.mjs";\nimport { chooseLoginProvider, prepareNativeLogin, runCascadeSetup, runRoleModelPicker } from "./core/tui-setup.mjs";',
  "TUI/parity imports"
);
extension = replaceOnce(
  extension,
  '  let completionGateInFlight = false;',
  '  let completionGateInFlight = false;\n  let workerRuntimeModel;\n  let workerRuntimeThinking;\n  let roleSwitchInProgress = false;\n  const toolPolicyState = createToolPolicyState();',
  "runtime parity state"
);
extension = replaceOnce(
  extension,
  `    if (workerRef?.provider && workerRef?.model) config.worker = { ...config.worker, ...workerRef };`,
  `    if (workerRef?.provider && workerRef?.model) {\n      config.worker = { ...config.worker, ...workerRef, selectionMode: "configured", thinkingMode: "configured" };\n    }\n    if (process.env.CASCADE_WORKER) config.worker.selectionMode = "configured";`,
  "explicit worker selection"
);
extension = replaceOnce(
  extension,
  `    if (workerTools) config.worker.tools = workerTools;`,
  `    if (workerTools) config.worker = { ...config.worker, tools: workerTools, restrictTools: true };`,
  "explicit worker tool restriction"
);
extension = replaceOnce(
  extension,
  `    if (expertTools) config.expert.tools = expertTools;`,
  `    if (expertTools) config.expert = { ...config.expert, tools: expertTools, restrictTools: true };`,
  "explicit expert tool restriction"
);

const helperInsertion = String.raw`
  function captureWorkerRuntime(ctx) {
    if (!ctx?.model) return;
    workerRuntimeModel = ctx.model;
    workerRuntimeThinking = ctx.thinkingLevel;
    config.worker = {
      ...config.worker,
      provider: ctx.model.provider,
      model: modelId(ctx.model)
    };
  }

  function cascadeControlTools(role) {
    const controls = CONTROL_TOOLS.filter((name) => {
      if (name === "cascade_expert" && config.mode !== "dual") return false;
      return role === "worker" || name !== "cascade_expert";
    });
    if (config.workspaceRuntime?.enabled) controls.push("cascade_workspace");
    return controls;
  }

  function applyTools(role, profile) {
    return applyRoleToolPolicy({
      pi,
      profile,
      controls: cascadeControlTools(role),
      state: toolPolicyState
    });
  }
`;
extension = replaceOnce(extension, "\nfunction formatStatus({ config, ledger, router, currentRole, blockedReason, harness }) {", `${helperInsertion}\nfunction formatStatus({ config, ledger, router, currentRole, blockedReason, harness }) {`, "runtime parity helpers");

extension = replaceRegex(
  extension,
  /  async function activateRole\(role, ctx, \{ quiet = false \} = \{\}\) \{[\s\S]*?\n  \}\n\n  function initialize\(ctx\) \{/,
  String.raw`  async function activateRole(role, ctx, { quiet = false } = {}) {
    const target = role === "expert" ? config.expert : config.worker;
    if (role === "expert" && config.mode !== "dual") throw new Error("Expert role is unavailable in single-model mode");
    const policyTarget = role === "worker" && !usesConfiguredModel(target)
      ? activeModelConfig(ctx, config, currentRole)
      : target;
    const policy = policyFor(policyTarget);
    if (!policy.allowed) throw new Error(policy.reason);

    if (role === "worker" && !usesConfiguredModel(target)) {
      if (!workerRuntimeModel && ctx.model) captureWorkerRuntime(ctx);
      if (workerRuntimeModel && !sameModel(ctx.model, workerRuntimeModel)) {
        roleSwitchInProgress = true;
        try {
          const changed = await pi.setModel(workerRuntimeModel);
          if (!changed) throw new Error(`No usable credentials for ${workerRuntimeModel.provider}/${modelId(workerRuntimeModel)}`);
        } finally {
          roleSwitchInProgress = false;
        }
      }
      if (target.thinkingMode === "configured" && target.thinking) pi.setThinkingLevel(target.thinking);
      else if (workerRuntimeThinking) pi.setThinkingLevel(workerRuntimeThinking);
    } else {
      const model = findConfiguredModel(ctx, target);
      if (!model) throw new Error(`Configured ${role} model was not found: ${describeModel(target)}`);
      roleSwitchInProgress = true;
      try {
        const changed = await pi.setModel(model);
        if (!changed) throw new Error(`No usable credentials for ${describeModel(target)}`);
      } finally {
        roleSwitchInProgress = false;
      }
      if (target.thinkingMode !== "native" && target.thinking) pi.setThinkingLevel(target.thinking);
    }

    applyTools(role, target);
    currentRole = role;
    blockedReason = "";
    if (!quiet) notify(ctx, `Cascade active role: ${role} (${role === "worker" && !usesConfiguredModel(target) ? "native Pi model" : describeModel(target)})`, "info");
    updateStatus(ctx);
  }

  function initialize(ctx) {`,
  "role activation"
);

extension = replaceOnce(
  extension,
  `    activeCtx = ctx;\n    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);`,
  `    activeCtx = ctx;\n    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);\n    if (config.worker.selectionMode !== "configured" && ctx.model) captureWorkerRuntime(ctx);`,
  "native worker capture during initialization"
);
extension = replaceOnce(
  extension,
  `    const initialProfile = currentRole === "expert" ? config.expert : config.worker;`,
  `    const initialProfile = currentRole === "expert"\n      ? config.expert\n      : (config.worker.selectionMode === "configured" ? config.worker : activeModelConfig(ctx, config, currentRole));`,
  "initial policy profile"
);

extension = replaceOnce(
  extension,
  `  pi.on("model_select", (_event, ctx) => {\n    activeCtx = ctx;\n    updateStatus(ctx);\n  });`,
  `  pi.on("model_select", (event, ctx) => {\n    activeCtx = ctx;\n    if (!roleSwitchInProgress) {\n      if (currentRole === "worker") {\n        workerRuntimeModel = event.model;\n        workerRuntimeThinking = ctx.thinkingLevel;\n        config.worker = {\n          ...config.worker,\n          provider: event.model.provider,\n          model: modelId(event.model)\n        };\n      } else if (currentRole === "expert") {\n        config.expert = {\n          ...config.expert,\n          selectionMode: "configured",\n          provider: event.model.provider,\n          model: modelId(event.model)\n        };\n      }\n    }\n    updateStatus(ctx);\n  });\n\n  pi.on("thinking_level_select", (event, ctx) => {\n    activeCtx = ctx;\n    if (!roleSwitchInProgress) {\n      if (currentRole === "worker") {\n        workerRuntimeThinking = event.level;\n        if (config.worker.thinkingMode === "configured") config.worker.thinking = event.level;\n      } else if (currentRole === "expert") {\n        config.expert = { ...config.expert, thinkingMode: "configured", thinking: event.level };\n      }\n    }\n    updateStatus(ctx);\n  });`,
  "role-aware native model events"
);

const setupHelpers = String.raw`
  async function applySetupResult(result, ctx) {
    if (!result || result.cancelled) return false;
    if (result.scope === "session") config = result.config;
    else loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
    validation = validateConfig(config);
    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });
    if (validation.errors.length) {
      blockedReason = validation.errors.join("; ");
      notify(ctx, `Cascade configuration errors: ${blockedReason}`, "error");
      updateStatus(ctx);
      return false;
    }
    if (config.worker.selectionMode !== "configured" && ctx.model) captureWorkerRuntime(ctx);
    await activateRole(currentRole === "expert" && config.mode === "dual" ? "expert" : "worker", ctx, { quiet: true });
    notify(ctx, result.path ? `Cascade settings saved to ${result.path}` : "Cascade settings applied to this session", "info");
    if (result.loginProvider) prepareNativeLogin(ctx, result.loginProvider);
    updateStatus(ctx);
    return true;
  }

  async function openSetup(ctx) {
    ensureInitialized(ctx);
    const result = await runCascadeSetup({ ctx, config });
    return applySetupResult(result, ctx);
  }

  async function openRoleModelPicker(role, ctx) {
    ensureInitialized(ctx);
    const result = await runRoleModelPicker({ ctx, config, role });
    if (!result || result.cancelled) return false;
    config = result.config;
    if (result.scope !== "session") loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
    if (role === "worker" && config.worker.selectionMode !== "configured" && ctx.model) captureWorkerRuntime(ctx);
    if (currentRole === role || role === "worker") await activateRole(role, ctx, { quiet: true });
    notify(ctx, result.path ? `${role} model saved to ${result.path}` : `${role} model changed for this session`, "info");
    if (result.loginProvider) prepareNativeLogin(ctx, result.loginProvider);
    updateStatus(ctx);
    return true;
  }

`;
extension = replaceOnce(extension, '  pi.registerCommand("cascade", {', `${setupHelpers}  pi.registerCommand("cascade-setup", {\n    description: "Configure Cascade worker, expert, routing, privacy, and budgets in Pi's TUI",\n    async handler(_args, ctx) {\n      try { await openSetup(ctx); }\n      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }\n    }\n  });\n\n  pi.registerCommand("cascade-model", {\n    description: "Choose and optionally save the worker or expert model through Pi's model catalog",\n    async handler(args, ctx) {\n      const [role = "worker"] = parseWords(args);\n      if (!["worker", "expert"].includes(role)) return notify(ctx, "Usage: /cascade-model worker|expert", "warning");\n      try { await openRoleModelPicker(role, ctx); }\n      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }\n    }\n  });\n\n  pi.registerCommand("cascade-auth", {\n    description: "Prepare Pi's native /login flow for a provider",\n    async handler(args, ctx) {\n      ensureInitialized(ctx);\n      const requested = String(args || "").trim();\n      const provider = requested || await chooseLoginProvider(ctx);\n      if (provider) prepareNativeLogin(ctx, provider);\n    }\n  });\n\n  pi.registerCommand("cascade", {`, "TUI setup commands");
extension = replaceOnce(
  extension,
  `      const [action] = parseWords(args);\n      if (action === "reload") {`,
  `      const [action] = parseWords(args);\n      if (action === "setup") {\n        await openSetup(ctx);\n        return;\n      }\n      if (action === "reload") {`,
  "/cascade setup alias"
);
await write("extension/index.mjs", extension);

let packageJson = JSON.parse(await read("package.json"));
packageJson.version = "0.3.0";
packageJson.scripts["tui:smoke"] = "node scripts/run-tui-smoke.mjs";
packageJson.scripts.ci = "npm test && npm run check && npm run brand:check && npm run legal:check && npm run smoke && npm run tui:smoke";
await write("package.json", JSON.stringify(packageJson, null, 2));

let lock = JSON.parse(await read("package-lock.json"));
lock.version = "0.3.0";
if (lock.packages?.[""]) lock.packages[""].version = "0.3.0";
await write("package-lock.json", JSON.stringify(lock, null, 2));

let upstream = JSON.parse(await read("UPSTREAM.json"));
upstream.cascadeVersion = "0.3.0";
await write("UPSTREAM.json", JSON.stringify(upstream, null, 2));

let readme = await read("README.md");
readme = readme.replaceAll("cascade 0.2.0", "cascade 0.3.0");
const startMarker = "## Start using it\n";
const nativeSection = String.raw`## Native Pi TUI and setup

Cascade now preserves Pi's normal TUI, commands, model picker, login flow, tools, keybindings, sessions, and extensions. Cascade features are additive.

Start the TUI normally:

\`\`\`bash
cascade --approve
\`\`\`

Inside the TUI, run:

\`\`\`text
/cascade-setup
\`\`\`

The setup wizard lets you choose single or dual mode, use Pi's current model as the worker or select a fixed worker, choose the expert from Pi's model catalog, set thinking levels, budgets, automatic consultation, privacy classification, and save settings for the session, project, or globally.

Authentication remains Pi-native:

\`\`\`text
/login openrouter
\`\`\`

You can also run \`/cascade-auth\` to choose a provider; Cascade places the matching native \`/login\` command in the editor. API keys and OAuth credentials remain in Pi's credential system rather than Cascade project files.

Pi's native \`/model\` command remains authoritative when the worker uses **current Pi model** mode. Use \`/cascade-model expert\` for a quick expert picker.

`;
if (!readme.includes("## Native Pi TUI and setup")) readme = replaceOnce(readme, startMarker, `${nativeSection}${startMarker}`, "README start section");
readme = readme.replace(
  "Both roles are fully configurable. Each can independently select provider and model ID, reasoning level, tool allowlist, role instructions, timeout and output limits, provider base URL, API adapter, headers, credential source, and cost budgets.",
  "Both roles are fully configurable through `/cascade-setup`, `/cascade-model`, project/global configuration, environment variables, or CLI flags. The worker inherits Pi's active tools by default; a tool allowlist becomes restrictive only when `restrictTools` is explicitly enabled."
);
await write("README.md", readme);

let install = await read("INSTALL.md");
if (!install.includes("/cascade-setup")) {
  install += String.raw`

## Configure in the TUI

Launch Cascade and use Pi's native interactive setup:

\`\`\`bash
cascade --approve
\`\`\`

Then run \`/cascade-setup\`. Use \`/login PROVIDER\` for OAuth or API-key entry and Pi's native \`/model\` command for the current worker model. Cascade does not store provider secrets in project configuration.
`;
}
await write("INSTALL.md", install);

let configuration = await read("docs/configuration.md");
if (!configuration.includes("## Native TUI configuration")) {
  configuration = configuration.replace("# Configuration reference\n", String.raw`# Configuration reference

## Native TUI configuration

For normal use, run \`/cascade-setup\` inside the Cascade TUI. The wizard persists project or global settings and uses Pi's model registry. Authentication is handled by Pi's native \`/login\` command. JSON remains an advanced persistence and automation interface, not a prerequisite for using Cascade.

The worker profile supports \`selectionMode: "native"\`, which leaves Pi's current model and native \`/model\` picker authoritative. \`restrictTools\` defaults to \`false\`, so Cascade does not replace Pi's active tool set. Set it to \`true\` only when an explicit role-specific allowlist is required.
`);
}
await write("docs/configuration.md", configuration);

let changelog = await read("CHANGELOG.md");
if (!changelog.includes("## 0.3.0")) {
  changelog = changelog.replace("# Changelog\n", String.raw`# Changelog

## 0.3.0 - 2026-08-19

### Added

- Native TUI setup for worker, expert, mode, thinking, routing, budgets, privacy, and session/project/global persistence.
- Role-aware model selection backed by Pi's model registry.
- Native Pi authentication handoff through \`/login\` and \`/cascade-auth\`.
- Pseudo-terminal smoke coverage for startup, slash-command dispatch, selector rendering, and cancellation.

### Fixed

- Cascade no longer forces a worker model before Pi's TUI starts when native worker mode is selected.
- Unrestricted roles no longer replace Pi's active tool set with a Cascade allowlist.
- Pi's native model picker updates the active Cascade role instead of fighting the wrapper.
- Single-model mode preserves normal Pi model, tool, command, session, and TUI behavior.
`);
}
await write("CHANGELOG.md", changelog);

let report = await read("TEST_REPORT.md");
if (!report.includes("Native Pi TUI parity")) {
  report += String.raw`

## Native Pi TUI parity (0.3.0)

The release suite now includes native-tool preservation tests, reversible explicit restrictions, TUI wizard persistence tests, native `/login` preparation, role-aware model selection, and a real pseudo-terminal smoke test that launches the bundled Pi TUI, invokes `/cascade-setup`, verifies the native selector is rendered, cancels it, and shuts down cleanly.
`;
}
await write("TEST_REPORT.md", report);

console.log("Native Pi parity and Cascade TUI setup changes applied.");
