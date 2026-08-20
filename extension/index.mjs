import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadEffectiveConfig, validateConfig } from "./core/config.mjs";
import { DEFAULT_CONFIG, PACKAGE_VERSION } from "./core/defaults.mjs";
import { runExpertEpisode } from "./core/expert-runner.mjs";
import { HarnessStore, proposalTemplate } from "./core/harness.mjs";
import { EvidenceLedger, collectGitState, estimateUsageCost, extractTextContent, normalizeUsage } from "./core/ledger.mjs";
import {
  evaluateContributorPolicy,
  inspectToolCallForPrivacy,
  isContributorModel,
  redactSecrets
} from "./core/privacy.mjs";
import { findConfiguredModel, providerCostFor, registerConfiguredProviders } from "./core/providers.mjs";
import { AdaptiveRouter } from "./core/router.mjs";
import { Schema } from "./core/schema.mjs";
import {
  discoverVerificationCommands,
  formatVerificationPlan,
  isTrustedVerificationCommand,
  runVerificationPlan,
  summarizeVerificationReport
} from "./core/verification.mjs";
import { runProgrammaticWorkspace } from "./core/workspace.mjs";
import { modelReference, parseModelReference, shortHash, truncateText } from "./core/util.mjs";
import { applyRoleToolPolicy, createToolPolicyState, modelId, sameModel, usesConfiguredModel } from "./core/pi-parity.mjs";
import { chooseLoginProvider, prepareNativeLogin, runCascadeSetup, runCompactionSetup, runRoleModelPicker } from "./core/tui-setup.mjs";
import { getCascadeGlobalCompaction } from "./core/pi-settings.mjs";

const EXTENSION_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = dirname(dirname(EXTENSION_PATH));
const CONTROL_TOOLS = ["cascade_expert", "cascade_route", "cascade_checkpoint", "cascade_refine"];

const ExpertSchema = Schema.object({
  question: Schema.string({ minLength: 1, description: "The exact uncertainty or decision the expert should resolve" }),
  mode: Schema.enum(["consult", "review", "investigate", "takeover"], { default: "consult" })
}, ["question"]);

const RouteSchema = Schema.object({
  refreshRepository: Schema.boolean({ default: true })
}, []);

const CheckpointSchema = Schema.object({
  verified: Schema.array(Schema.string(), { default: [] }),
  open: Schema.array(Schema.string(), { default: [] }),
  next: Schema.string({ minLength: 1 }),
  doneDefinition: Schema.string({ default: "" })
}, ["next"]);

const EditSchema = Schema.object({
  action: Schema.enum(["create", "update", "delete"]),
  kind: Schema.enum(["prompt", "memory", "skill", "subagent"]),
  id: Schema.string(),
  title: Schema.string(),
  content: Schema.string(),
  path: Schema.string(),
  reason: Schema.string()
}, ["action", "kind"]);

const WorkspaceSchema = Schema.object({
  code: Schema.string({ minLength: 1, description: "Bounded Python code. Assign the JSON-serializable answer to result and persist data in state." }),
  input: { type: "object", additionalProperties: true, default: {} },
  reset: Schema.boolean({ default: false })
}, ["code"]);

const RefineSchema = Schema.object({
  summary: Schema.string({ minLength: 1 }),
  rationale: Schema.string({ minLength: 1 }),
  expectedOutcome: Schema.string({ minLength: 1 }),
  predictedRegressions: Schema.array(Schema.string(), { default: [] }),
  scope: Schema.enum(["session", "repository", "model-pair", "ecosystem", "global"], { default: "repository" }),
  evidenceIds: Schema.array(Schema.string(), { default: [] }),
  edits: Schema.array(EditSchema, { minItems: 1 })
}, ["summary", "rationale", "expectedOutcome", "edits"]);

function textResult(text, details = undefined, isError = false) {
  return {
    content: [{ type: "text", text: String(text) }],
    details,
    isError
  };
}

function parseWords(args) {
  return String(args || "").trim().split(/\s+/).filter(Boolean);
}

function parseToolList(value) {
  if (typeof value !== "string") return undefined;
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
}

function positiveNumberFlag(value, name) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function configPathFromFlags(pi) {
  const value = pi.getFlag?.("cascade-config");
  if (typeof value === "string" && value.trim()) return value.trim();
  return process.env.CASCADE_CONFIG || undefined;
}

function projectTrustedFromEnvironment() {
  return ["1", "true", "yes", "on"].includes(String(process.env.CASCADE_PROJECT_TRUSTED || "").toLowerCase());
}

function describeModel(modelConfig) {
  if (!modelConfig) return "unconfigured";
  return modelReference(modelConfig) || `${modelConfig.provider || "?"}/${modelConfig.model || "?"}`;
}

function activeModelConfig(ctx, config, currentRole) {
  const provider = ctx.model?.provider;
  const id = ctx.model?.id || ctx.model?.model || ctx.model?.modelId;
  if (provider && id) return { provider, model: id };
  if (currentRole === "worker" && !usesConfiguredModel(config.worker)) return { provider: "native", model: "unselected" };
  return currentRole === "expert" ? config.expert : config.worker;
}

function formatStatus({ config, ledger, router, currentRole, blockedReason }) {
  const totals = ledger?.totals() || { expertCalls: 0, estimatedTotalCostUsd: 0 };
  const route = router?.snapshot() || { level: "worker", score: 0 };
  if (blockedReason) return `Cascade · attention: ${truncateText(blockedReason, 54)}`;
  const expert = config.mode === "dual" ? ` · expert ${totals.expertCalls}` : "";
  return `${currentRole} · ${config.mode} · route ${route.level}${expert} · $${Number(totals.estimatedTotalCostUsd || 0).toFixed(3)}`;
}

function buildSystemAppendix({ config, router, harness, currentRole, contributorPolicy }) {
  const role = currentRole === "expert" ? config.expert : config.worker;
  const route = router.snapshot();
  const harnessOverlay = harness.promptOverlay();
  const lines = [
    "# Cascade runtime",
    "",
    `Mode: ${config.mode}. Active role: ${currentRole}. Active profile: ${describeModel(role)}.`,
    `Current route state: ${route.level} (score ${route.score}).`,
    "Use executable repository evidence before conclusions. Keep one workspace owner. Record a checkpoint after material progress or before changing strategy.",
    "Do not restart repository investigation when a verified evidence packet already contains the fact. Preserve failed approaches so they are not repeated.",
    "Tests, compiler output, static analysis, reproductions, and repository facts outrank model confidence.",
    "The cascade_refine tool may propose small scoped harness changes, but proposals are not active until replayed and promoted by policy.",
    ""
  ];
  if (config.mode === "dual" && currentRole === "worker") {
    lines.push(
      `Configured expert: ${describeModel(config.expert)}.`,
      "Use cascade_expert only for a concrete unresolved question, contradictory evidence, repeated failure, high-risk semantic review, or a justified temporary takeover.",
      "Consultation and review are read-only. Takeover may edit only when the expert profile explicitly includes edit/write tools.",
      ""
    );
  }
  if (contributorPolicy.contributor) {
    lines.push(
      `This model uses a contributor endpoint under repository classification ${config.privacy.classification}.`,
      "Never inspect denied paths, secrets, credentials, customer data, or environment dumps. Local tool calls violating policy will be blocked.",
      ""
    );
  }
  if (config.workspaceRuntime?.enabled) {
    lines.push(
      "The cascade_workspace tool provides a bounded persistent JSON/Python workspace for computation. It is available only under the configured external sandbox, unless the operator explicitly acknowledged unsandboxed execution.",
      "Use it for structured intermediate state or local computation, not as a substitute for repository tools.",
      ""
    );
  }
  if (role.instructions) lines.push("## Profile instructions", role.instructions, "");
  if (harnessOverlay) lines.push(harnessOverlay, "");
  return lines.join("\n").trim();
}

export default function cascadeExtension(pi) {
  pi.registerFlag("cascade-config", { description: "Path to a Cascade JSON configuration", type: "string" });
  pi.registerFlag("cascade-mode", { description: "Cascade mode: single or dual", type: "string" });
  pi.registerFlag("cascade-worker", { description: "Worker provider/model", type: "string" });
  pi.registerFlag("cascade-expert", { description: "Expert provider/model", type: "string" });
  pi.registerFlag("cascade-worker-thinking", { description: "Worker thinking level", type: "string" });
  pi.registerFlag("cascade-expert-thinking", { description: "Expert thinking level", type: "string" });
  pi.registerFlag("cascade-worker-tools", { description: "Comma-separated worker tool allowlist", type: "string" });
  pi.registerFlag("cascade-expert-tools", { description: "Comma-separated expert tool allowlist", type: "string" });
  pi.registerFlag("cascade-worker-instructions", { description: "Worker profile instructions", type: "string" });
  pi.registerFlag("cascade-expert-instructions", { description: "Expert profile instructions", type: "string" });
  pi.registerFlag("cascade-expert-timeout-ms", { description: "Expert subprocess timeout in milliseconds", type: "string" });
  pi.registerFlag("cascade-expert-max-output-characters", { description: "Maximum expert output characters", type: "string" });

  let config = DEFAULT_CONFIG;
  let validation = { errors: [], warnings: [] };
  let configSources = [];
  let ledger;
  let router;
  let harness;
  let currentRole = process.env.CASCADE_CHILD === "1" ? "expert" : "worker";
  let blockedReason = "";
  let initialized = false;
  let expertInFlight = false;
  let activeCtx;
  let verifiedDiffKey = "";
  let lastGateDiffKey = "";
  let completionGateRuns = 0;
  let completionGateInFlight = false;
  let workerRuntimeModel;
  let workerRuntimeThinking;
  let roleSwitchInProgress = false;
  const toolPolicyState = createToolPolicyState();

  function captureWorkerRuntime(ctx) {
    if (!ctx?.model) return;
    workerRuntimeModel = ctx.model;
    workerRuntimeThinking = ctx.thinkingLevel;
    config.worker = { ...config.worker, provider: ctx.model.provider, model: modelId(ctx.model) };
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
    return applyRoleToolPolicy({ pi, profile, controls: cascadeControlTools(role), state: toolPolicyState });
  }

  function loadConfig(cwd, projectTrusted) {
    const result = loadEffectiveConfig({
      cwd,
      projectTrusted,
      explicitPath: configPathFromFlags(pi),
      throwOnError: false
    });
    config = result.config;
    const flagMode = pi.getFlag?.("cascade-mode");
    if (flagMode === "single" || flagMode === "dual") config.mode = flagMode;
    const workerFlag = pi.getFlag?.("cascade-worker");
    const workerRef = parseModelReference(typeof workerFlag === "string" ? workerFlag : "");
    if (workerRef?.provider && workerRef?.model) {
      config.worker = { ...config.worker, ...workerRef, selectionMode: "configured", thinkingMode: "configured" };
    }
    if (process.env.CASCADE_WORKER) config.worker.selectionMode = "configured";
    const expertFlag = pi.getFlag?.("cascade-expert");
    const expertRef = parseModelReference(typeof expertFlag === "string" ? expertFlag : "");
    if (expertRef?.provider && expertRef?.model) {
      config.expert = { ...config.expert, ...expertRef, selectionMode: "configured", thinkingMode: "configured" };
    }
    const workerThinking = pi.getFlag?.("cascade-worker-thinking");
    if (typeof workerThinking === "string" && workerThinking) config.worker.thinking = workerThinking;
    const expertThinking = pi.getFlag?.("cascade-expert-thinking");
    if (typeof expertThinking === "string" && expertThinking) config.expert.thinking = expertThinking;
    const workerTools = parseToolList(pi.getFlag?.("cascade-worker-tools"));
    if (workerTools) config.worker = { ...config.worker, tools: workerTools, restrictTools: true };
    const expertTools = parseToolList(pi.getFlag?.("cascade-expert-tools"));
    if (expertTools) config.expert = { ...config.expert, tools: expertTools, restrictTools: true };
    const workerInstructions = pi.getFlag?.("cascade-worker-instructions");
    if (typeof workerInstructions === "string") config.worker.instructions = workerInstructions;
    const expertInstructions = pi.getFlag?.("cascade-expert-instructions");
    if (typeof expertInstructions === "string") config.expert.instructions = expertInstructions;
    const expertTimeout = positiveNumberFlag(pi.getFlag?.("cascade-expert-timeout-ms"), "cascade-expert-timeout-ms");
    if (expertTimeout !== undefined) config.expert.timeoutMs = expertTimeout;
    const expertMaxOutput = positiveNumberFlag(
      pi.getFlag?.("cascade-expert-max-output-characters"),
      "cascade-expert-max-output-characters"
    );
    if (expertMaxOutput !== undefined) config.expert.maxOutputCharacters = expertMaxOutput;
    validation = validateConfig(config);
    configSources = result.sources;
    return result;
  }

  try {
    loadConfig(process.cwd(), projectTrustedFromEnvironment());
    registerConfiguredProviders(pi, config, { onWarning: (message) => console.error(`[cascade] ${message}`) });
  } catch (error) {
    console.error(`[cascade] preliminary configuration failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  function updateStatus(ctx = activeCtx) {
    if (!ctx || !config.ui.showStatus) return;
    ctx.ui.setStatus("cascade", formatStatus({ config, ledger, router, currentRole, blockedReason, harness }));
  }

  function notify(ctx, message, type = "info") {
    if (ctx?.ui) ctx.ui.notify(message, type);
  }

  function policyFor(modelConfig) {
    return evaluateContributorPolicy(config, modelConfig);
  }

  function sessionBudget() {
    const totals = ledger?.totals?.() || { estimatedTotalCostUsd: 0 };
    const maximum = Number(config?.budgets?.maxSessionEstimatedCostUsd ?? Infinity);
    return {
      allowed: !Number.isFinite(maximum) || totals.estimatedTotalCostUsd < maximum,
      maximum,
      current: Number(totals.estimatedTotalCostUsd || 0)
    };
  }

  function repositoryDiffKey(cwd) {
    const state = collectGitState(cwd);
    if (!state.isGitRepository) return { key: "not-git", state };
    return {
      key: shortHash(`${state.revision || ""}
${state.status || ""}
${state.diffStat || ""}
${state.stagedStat || ""}`, 24),
      state
    };
  }

  async function activateRole(role, ctx, { quiet = false } = {}) {
    const target = role === "expert" ? config.expert : config.worker;
    if (role === "expert" && config.mode !== "dual") throw new Error("Expert role is unavailable in single-model mode");
    const policyTarget = role === "worker" && !usesConfiguredModel(target)
      ? activeModelConfig(ctx, config, currentRole)
      : target;
    const policy = policyFor(policyTarget);
    if (!policy.allowed) throw new Error(policy.reason);

    roleSwitchInProgress = true;
    try {
      if (role === "worker" && !usesConfiguredModel(target)) {
        if (!workerRuntimeModel && ctx.model) captureWorkerRuntime(ctx);
        if (workerRuntimeModel && !sameModel(ctx.model, workerRuntimeModel)) {
          const changed = await pi.setModel(workerRuntimeModel);
          if (!changed) throw new Error(`No usable credentials for ${workerRuntimeModel.provider}/${modelId(workerRuntimeModel)}`);
        }
        if (target.thinkingMode === "configured" && target.thinking) pi.setThinkingLevel(target.thinking);
        else if (workerRuntimeThinking) pi.setThinkingLevel(workerRuntimeThinking);
      } else {
        const model = findConfiguredModel(ctx, target);
        if (!model) throw new Error(`Configured ${role} model was not found: ${describeModel(target)}`);
        const changed = await pi.setModel(model);
        if (!changed) throw new Error(`No Cascade credential for ${describeModel(target)}. Run /login ${target.provider}.`);
        if (target.thinkingMode !== "native" && target.thinking) pi.setThinkingLevel(target.thinking);
      }
    } finally {
      roleSwitchInProgress = false;
    }

    applyTools(role, target);
    currentRole = role;
    blockedReason = "";
    if (!quiet) {
      const label = role === "worker" && !usesConfiguredModel(target) ? "current model" : describeModel(target);
      notify(ctx, `Active ${role}: ${label}`, "info");
    }
    updateStatus(ctx);
  }

  function initialize(ctx) {
    activeCtx = ctx;
    const result = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
    if (!usesConfiguredModel(config.worker) && ctx.model) captureWorkerRuntime(ctx);
    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });
    const piSessionId = ctx.sessionManager?.getSessionId?.();
    ledger = new EvidenceLedger({ cwd: ctx.cwd, config, harnessManifest: { pending: true }, sessionId: piSessionId });
    harness = new HarnessStore({ cwd: ctx.cwd, config, sessionId: piSessionId || ledger.sessionId });
    ledger.harnessManifest = harness.manifest();
    ledger.record("harness_manifest", ledger.harnessManifest, { status: "verified" });
    router = new AdaptiveRouter(config);
    router.restore(ledger.latest("router_state")?.data);
    const initialDiff = repositoryDiffKey(ctx.cwd);
    verifiedDiffKey = initialDiff.key;
    lastGateDiffKey = initialDiff.key;
    completionGateRuns = 0;
    completionGateInFlight = false;
    blockedReason = "";
    const initialProfile = currentRole === "expert"
      ? config.expert
      : (usesConfiguredModel(config.worker) ? config.worker : activeModelConfig(ctx, config, currentRole));
    const initialPolicy = policyFor(initialProfile);
    if (!initialPolicy.allowed) blockedReason = initialPolicy.reason;
    initialized = true;
    for (const warning of result.validation.warnings) notify(ctx, warning, "warning");
    if (result.validation.errors.length) {
      notify(ctx, `Configuration warning: ${result.validation.errors.join("; ")}. Use /cascade-setup to repair it.`, "warning");
    }
    if (process.env.CASCADE_STARTUP_WARNING) notify(ctx, process.env.CASCADE_STARTUP_WARNING, "warning");
    updateStatus(ctx);
  }

  function ensureInitialized(ctx) {
    if (!initialized || activeCtx?.cwd !== ctx.cwd) initialize(ctx);
  }

  function evidencePacket(question) {
    return ledger.buildEvidencePacket({
      question,
      routeState: router.snapshot(),
      maximumCharacters: config.budgets.maxEvidenceCharacters,
      maximumEntries: config.budgets.maxLedgerEntriesInHandoff,
      harnessState: {
        manifest: harness.manifest(),
        activeEntries: harness.activeEntries().map((entry) => ({
          id: entry.id,
          scope: entry.scope,
          kind: entry.kind,
          title: entry.title,
          content: truncateText(entry.content, 800)
        }))
      },
      includeGitState: config.evidence.includeGitState
    });
  }

  async function performExpert({ question, mode = "consult", ctx, forced = false }) {
    ensureInitialized(ctx);
    if (config.mode !== "dual") throw new Error("Cascade is in single-model mode");
    if (mode === "takeover" && !forced && !config.routing.allowModelInitiatedTakeover) {
      throw new Error("Model-initiated expert takeover is disabled; use /cascade-takeover or enable routing.allowModelInitiatedTakeover");
    }
    if (expertInFlight) throw new Error("An expert episode is already running");
    const policy = policyFor(config.expert);
    if (!policy.allowed) throw new Error(`Expert endpoint blocked: ${policy.reason}`);
    const admission = router.canConsult(ledger, { ignoreCooldown: forced });
    if (!admission.allowed) throw new Error(admission.reason);
    const packet = evidencePacket(question);
    const beforeDiff = mode === "takeover" ? repositoryDiffKey(ctx.cwd).key : "";
    expertInFlight = true;
    updateStatus(ctx);
    try {
      const result = await runExpertEpisode({
        config,
        cwd: ctx.cwd,
        mode,
        question,
        evidenceJson: packet.json,
        signal: ctx.signal,
        projectTrusted: ctx.isProjectTrusted?.() ?? false,
        extensionPath: EXTENSION_PATH
      });
      ledger.recordExpertCall({
        question,
        mode,
        model: result.model,
        result: result.text,
        usage: result.usage,
        estimatedCostUsd: result.estimatedCostUsd,
        routeState: router.snapshot()
      });
      router.markConsulted();
      if (mode === "takeover") {
        const afterDiff = repositoryDiffKey(ctx.cwd).key;
        if (afterDiff !== beforeDiff) {
          lastGateDiffKey = afterDiff;
          completionGateRuns = 0;
          ledger.record("expert_workspace_change", { beforeDiff, afterDiff }, { status: "verified" });
        }
      }
      pi.appendEntry("cascade.expert", {
        mode,
        question: config.privacy.redactSecrets ? redactSecrets(question) : question,
        result: result.parsed,
        model: result.model,
        usage: result.usage,
        estimatedCostUsd: result.estimatedCostUsd,
        at: new Date().toISOString()
      });
      updateStatus(ctx);
      return result;
    } finally {
      expertInFlight = false;
      updateStatus(ctx);
    }
  }

  pi.registerTool({
    name: "cascade_expert",
    label: "Cascade expert",
    description: "Consult, review with, investigate through, or temporarily delegate implementation to the configured expert model using a compact evidence handoff. Use only for a concrete uncertainty or justified escalation.",
    promptSnippet: "cascade_expert: bounded evidence-based consultation with the configured expert model",
    parameters: ExpertSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const result = await performExpert({ question: params.question, mode: params.mode || "consult", ctx });
        const visible = JSON.stringify({
          model: result.model,
          mode: result.mode,
          estimatedCostUsd: result.estimatedCostUsd,
          durationMs: result.durationMs,
          response: result.parsed
        }, null, 2);
        return textResult(visible, result);
      } catch (error) {
        return textResult(`Expert episode failed: ${error instanceof Error ? error.message : String(error)}`, { error: String(error) }, true);
      }
    }
  });

  pi.registerTool({
    name: "cascade_route",
    label: "Cascade route",
    description: "Inspect the current trajectory-conditioned routing state and expert admission budget.",
    promptSnippet: "cascade_route: inspect escalation evidence and budget",
    parameters: RouteSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ensureInitialized(ctx);
      if (params.refreshRepository !== false) router.refreshRepositorySignals(ctx.cwd);
      return textResult(JSON.stringify({
        route: router.snapshot(),
        expertAdmission: router.canConsult(ledger),
        totals: ledger.totals(),
        mode: config.mode,
        worker: describeModel(config.worker),
        expert: config.mode === "dual" ? describeModel(config.expert) : undefined
      }, null, 2));
    }
  });

  pi.registerTool({
    name: "cascade_checkpoint",
    label: "Cascade checkpoint",
    description: "Persist verified progress, open questions, and exactly one next action in the evidence ledger.",
    promptSnippet: "cascade_checkpoint: persist verified/open/next trajectory state",
    parameters: CheckpointSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ensureInitialized(ctx);
      const entry = ledger.record("checkpoint", {
        verified: params.verified || [],
        open: params.open || [],
        next: params.next,
        doneDefinition: params.doneDefinition || "",
        repository: router.refreshRepositorySignals(ctx.cwd)
      }, { status: "verified", summary: `Checkpoint: ${params.next}` });
      router.markProgress(`checkpoint ${entry.id}`);
      ledger.record("router_state", router.snapshot(), { status: "verified", summary: "Router state checkpointed" });
      pi.appendEntry("cascade.checkpoint", { id: entry.id, ...entry.data });
      updateStatus(ctx);
      return textResult(`Checkpoint ${entry.id} recorded. Next: ${params.next}`, entry);
    }
  });

  pi.registerTool({
    name: "cascade_workspace",
    label: "Cascade workspace",
    description: "Run bounded Python against a persistent JSON state workspace. Disabled by default and requires an external sandbox unless explicitly acknowledged as unsandboxed.",
    promptSnippet: "cascade_workspace: persistent structured local computation under operator sandbox policy",
    parameters: WorkspaceSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      ensureInitialized(ctx);
      try {
        const result = await runProgrammaticWorkspace({
          code: params.code,
          input: params.input || {},
          reset: Boolean(params.reset),
          cwd: ctx.cwd,
          config,
          sessionId: ctx.sessionManager?.getSessionId?.() || ledger.sessionId,
          signal
        });
        ledger.record("programmatic_workspace", {
          statePath: result.statePath,
          stateCharacters: result.stateCharacters,
          durationMs: result.durationMs,
          sandboxed: result.sandboxed,
          result: result.result
        }, { status: "verified", summary: "Programmatic workspace execution completed" });
        return textResult(JSON.stringify({
          result: result.result,
          stateCharacters: result.stateCharacters,
          durationMs: result.durationMs,
          sandboxed: result.sandboxed
        }, null, 2), result);
      } catch (error) {
        ledger.record("programmatic_workspace", { error: String(error) }, { status: "falsified" });
        return textResult(`Workspace execution failed: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
      }
    }
  });

  pi.registerTool({
    name: "cascade_refine",
    label: "Cascade refine",
    description: "Propose a small, evidence-backed, scoped harness change. This creates a candidate only; it does not change the active harness until replay evaluation and promotion.",
    promptSnippet: "cascade_refine: propose a versioned harness delta for later replay and promotion",
    parameters: RefineSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ensureInitialized(ctx);
      if (config.harnessLearning.mode === "off") return textResult("Harness learning is disabled.", undefined, true);
      try {
        const candidate = harness.propose({
          summary: params.summary,
          rationale: params.rationale,
          expectedOutcome: params.expectedOutcome,
          predictedRegressions: params.predictedRegressions || [],
          evidenceIds: params.evidenceIds || [],
          edits: params.edits
        }, {
          scope: params.scope || config.harnessLearning.scope,
          evidenceIds: params.evidenceIds || [],
          createdBy: `${currentRole}:${describeModel(currentRole === "worker" ? config.worker : config.expert)}`
        });
        ledger.record("harness_candidate", candidate, { status: "unverified", summary: `Harness candidate ${candidate.id}: ${candidate.summary}` });
        pi.appendEntry("cascade.harness-candidate", candidate);
        let disposition = "inactive until evaluated and promoted";
        const lowRisk = candidate.edits.every((edit) => ["prompt", "memory"].includes(edit.kind));
        if (config.harnessLearning.mode === "canary" && lowRisk) {
          harness.activateCanary(candidate.id);
          disposition = "active as a session canary; it is not promoted";
        } else if (
          config.harnessLearning.mode === "auto-local" &&
          config.harnessLearning.autoApplySessionMemories &&
          candidate.scope === "session" &&
          lowRisk
        ) {
          harness.promote(candidate.id, { force: true, promotedBy: "auto-local-policy" });
          disposition = "promoted automatically under the explicit auto-local policy";
        }
        return textResult(`Harness candidate ${candidate.id} proposed and is ${disposition}.`, candidate);
      } catch (error) {
        return textResult(`Harness proposal rejected: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
      }
    }
  });


  pi.on("session_start", async (_event, ctx) => {
    initialize(ctx);
    if (process.env.CASCADE_CHILD === "1") return;
    try {
      await activateRole("worker", ctx, { quiet: true });
    } catch (error) {
      blockedReason = "";
      notify(ctx, `${error instanceof Error ? error.message : String(error)} The TUI remains available; use /login, /model, or /cascade-setup.`, "warning");
      applyTools("worker", config.worker);
    }
    updateStatus(ctx);
  });

  pi.on("input", (event, ctx) => {
    ensureInitialized(ctx);
    const target = activeModelConfig(ctx, config, currentRole);
    const policy = policyFor(target);
    if (!policy.allowed) {
      blockedReason = policy.reason;
      notify(ctx, `Cascade blocked this prompt: ${policy.reason}`, "error");
      updateStatus(ctx);
      return { action: "handled" };
    }
    const budget = sessionBudget();
    if (!budget.allowed) {
      blockedReason = `session cost budget exhausted ($${budget.current.toFixed(4)} / $${budget.maximum.toFixed(4)})`;
      notify(ctx, `Cascade blocked this prompt: ${blockedReason}`, "error");
      updateStatus(ctx);
      return { action: "handled" };
    }
    if (policy.contributor && Array.isArray(event.images) && event.images.length > 0 && !config.privacy.allowImagesToContributor) {
      const reason = "contributor endpoint image input is disabled by privacy.allowImagesToContributor";
      ledger.record("privacy_block", { source: "input", reason, imageCount: event.images.length }, { status: "verified" });
      notify(ctx, `Cascade blocked this prompt: ${reason}`, "error");
      return { action: "handled" };
    }
    const original = String(event.text || "");
    const safeText = policy.contributor && config.privacy.redactSecrets ? redactSecrets(original) : original;
    ledger.recordUserGoal(safeText);
    if (safeText !== original) {
      ledger.record("privacy_redaction", { source: "input", redactedCharacters: original.length - safeText.length }, {
        status: "verified",
        summary: "Credential-like text was redacted before contributor inference"
      });
      notify(ctx, "Cascade redacted credential-like text before sending the prompt to the contributor endpoint.", "warning");
      return { action: "transform", text: safeText, images: event.images };
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", (event, ctx) => {
    ensureInitialized(ctx);
    const target = activeModelConfig(ctx, config, currentRole);
    const policy = policyFor(target);
    const appendix = buildSystemAppendix({ config, router, harness, currentRole, contributorPolicy: policy });
    return { systemPrompt: `${event.systemPrompt}\n\n${appendix}` };
  });

  pi.on("turn_start", (event, ctx) => {
    ensureInitialized(ctx);
    const budget = sessionBudget();
    if (!budget.allowed) {
      blockedReason = `session cost budget exhausted ($${budget.current.toFixed(4)} / $${budget.maximum.toFixed(4)})`;
      ledger.record("budget_stop", budget, { status: "verified", summary: blockedReason });
      notify(ctx, `Cascade stopped the turn: ${blockedReason}`, "error");
      ctx.abort?.();
      updateStatus(ctx);
      return;
    }
    router.onTurnStart(event.turnIndex);
    router.refreshRepositorySignals(ctx.cwd);
    updateStatus(ctx);
  });

  pi.on("tool_call", (event, ctx) => {
    ensureInitialized(ctx);
    const budget = sessionBudget();
    if (!budget.allowed) {
      const reason = `Cascade session cost budget exhausted ($${budget.current.toFixed(4)} / $${budget.maximum.toFixed(4)})`;
      ledger.record("budget_stop", { ...budget, toolName: event.toolName }, { status: "verified", summary: reason });
      return { block: true, terminate: true, reason };
    }
    const target = activeModelConfig(ctx, config, currentRole);
    const policy = policyFor(target);
    if (policy.contributor) {
      const inspection = inspectToolCallForPrivacy({ toolName: event.toolName, input: event.input, cwd: ctx.cwd, config });
      if (inspection.blocked) {
        ledger.record("privacy_block", { toolName: event.toolName, input: event.input, reason: inspection.reason }, { status: "verified" });
        router.addProtectedPathSignal(extractTextContent(event.input));
        updateStatus(ctx);
        return { block: true, terminate: true, reason: inspection.reason };
      }
    }
    ledger.recordToolCall(event.toolName, event.input);
    router.onToolCall(event.toolName, event.input);
  });

  pi.on("tool_result", (event, ctx) => {
    ensureInitialized(ctx);
    ledger.recordToolResult(event.toolName, event.input, event.content, event.isError, event.details);
    router.onToolResult({ toolName: event.toolName, input: event.input, result: event.content, isError: event.isError });
    if (!event.isError && ["edit", "write"].includes(event.toolName)) {
      const current = repositoryDiffKey(ctx.cwd).key;
      if (current !== lastGateDiffKey) completionGateRuns = 0;
      lastGateDiffKey = current;
    }
    if (!event.isError && event.toolName === "bash") {
      const command = String(event.input?.command || "");
      const verificationPlan = discoverVerificationCommands(ctx.cwd, config.verification.commands);
      if (isTrustedVerificationCommand(command, verificationPlan)) {
        const current = repositoryDiffKey(ctx.cwd).key;
        verifiedDiffKey = current;
        completionGateRuns = 0;
        ledger.record("verification_observation", {
          command,
          diffKey: current
        }, { status: "verified", summary: `Verification passed: ${command}` });
      }
    }
    if (router.shouldInjectRecommendation()) {
      const recommendation = router.recommendation();
      pi.sendMessage({
        customType: "cascade.route",
        content: [{ type: "text", text: recommendation }],
        display: false,
        details: router.snapshot()
      }, { triggerTurn: false });
    }
    updateStatus(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    ensureInitialized(ctx);
    if (event.message?.role !== "assistant") return;
    router.onAssistantMessage(event.message);
    const usage = normalizeUsage(event.message.usage || {});
    const profile = currentRole === "expert" ? config.expert : config.worker;
    const estimated = estimateUsageCost(usage, providerCostFor(config, profile));
    ledger.recordAssistantUsage(currentRole, usage, estimated);
    updateStatus(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    ensureInitialized(ctx);
    ledger.record("router_state", router.snapshot(), { status: "verified", summary: "Router state persisted at turn end" });
    if (process.env.CASCADE_CHILD === "1" || expertInFlight || ctx.hasPendingMessages?.()) return;
    const automatic = router.shouldAutoConsult(ledger);
    if (!automatic.consult) return;
    const question = `Resolve the current escalation signals and name the single best next action. Signals: ${router.snapshot().signals.map((signal) => signal.reason).join("; ")}`;
    try {
      const result = await performExpert({ question, mode: "consult", ctx });
      pi.sendMessage({
        customType: "cascade.expert-auto",
        content: [{ type: "text", text: `Automatic expert consultation:\n${JSON.stringify(result.parsed, null, 2)}` }],
        display: true,
        details: result
      }, { triggerTurn: true, deliverAs: "followUp" });
    } catch (error) {
      notify(ctx, `Automatic expert consultation failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
    } finally {
      ledger.record("router_state", router.snapshot(), { status: "verified", summary: "Router state persisted after consultation" });
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    ensureInitialized(ctx);
    if (
      process.env.CASCADE_CHILD === "1" ||
      !config.verification.requireBeforeCompletion ||
      completionGateInFlight ||
      expertInFlight ||
      ctx.hasPendingMessages?.()
    ) return;
    const current = repositoryDiffKey(ctx.cwd);
    if (!current.state.isGitRepository || current.key === verifiedDiffKey || current.state.changedFileCount === 0) return;
    if (current.key !== lastGateDiffKey) {
      completionGateRuns = 0;
      lastGateDiffKey = current.key;
    }
    const plan = discoverVerificationCommands(ctx.cwd, config.verification.commands);
    if (!plan.length) {
      ledger.record("completion_gate", {
        diffKey: current.key,
        outcome: "no-verifier",
        changedFiles: current.state.changedFiles
      }, { status: "inconclusive", summary: "Completion gate found changes but no verifier" });
      return;
    }
    if (completionGateRuns >= Number(config.verification.maxCompletionGateRuns || 1)) {
      notify(ctx, "Cascade completion gate remains unresolved after the configured retry limit.", "error");
      return;
    }
    completionGateRuns += 1;
    if (!config.verification.autoRunBeforeCompletion) {
      pi.sendMessage({
        customType: "cascade.completion-gate",
        content: [{ type: "text", text: `Workspace changes are not verified for the current diff. Run /cascade-verify before declaring completion.
${formatVerificationPlan(plan)}` }],
        display: true,
        details: { diffKey: current.key, plan }
      }, { triggerTurn: true, deliverAs: "followUp" });
      return;
    }
    completionGateInFlight = true;
    try {
      const report = await runVerificationPlan(plan, { cwd: ctx.cwd, timeoutMs: config.verification.timeoutMs, signal: ctx.signal });
      ledger.record("completion_verification", report, {
        status: report.ok ? "verified" : "falsified",
        summary: summarizeVerificationReport(report)
      });
      if (report.ok) {
        verifiedDiffKey = repositoryDiffKey(ctx.cwd).key;
        router.markProgress("completion verification passed");
        notify(ctx, summarizeVerificationReport(report), "info");
      } else {
        router.addSignal("verifierFailure", config.routing.weights.verifierFailure, "completion verification failed");
        pi.sendMessage({
          customType: "cascade.completion-gate",
          content: [{ type: "text", text: `Completion verification failed. Repair the failure before declaring completion.

${summarizeVerificationReport(report)}` }],
          display: true,
          details: report
        }, { triggerTurn: true, deliverAs: "followUp" });
      }
    } finally {
      completionGateInFlight = false;
      updateStatus(ctx);
    }
  });

  pi.on("session_before_compact", (event, ctx) => {
    ensureInitialized(ctx);
    const checkpoint = {
      goal: ledger.lastUserGoal,
      route: router.snapshot(),
      repository: collectGitState(ctx.cwd),
      harness: harness.manifest(),
      recentEvidenceIds: ledger.recent(24).map((entry) => entry.id),
      existingInstructions: event.customInstructions || ""
    };
    ledger.record("compaction_checkpoint", checkpoint, {
      status: "verified",
      summary: "Structured state captured before context compaction"
    });
    const instructions = [
      event.customInstructions || "",
      "Preserve the Cascade continuation state in the summary.",
      "Include: the exact user goal and constraints; verified facts and their evidence; unresolved questions; falsified hypotheses and failed approaches; current diff and verification status; one concrete next action; the active worker/expert profiles; route signals; and the harness manifest hash.",
      `Cascade checkpoint: ${JSON.stringify(checkpoint)}`
    ].filter(Boolean).join("\n\n");
    return { customInstructions: instructions };
  });

  pi.on("session_compact", (_event, ctx) => {
    ensureInitialized(ctx);
    ledger.record("compaction_completed", { route: router.snapshot(), harness: harness.manifest() }, {
      status: "verified",
      summary: "Context compaction completed"
    });
  });

  pi.on("model_select", (event, ctx) => {
    activeCtx = ctx;
    if (!roleSwitchInProgress) {
      if (currentRole === "worker") {
        workerRuntimeModel = event.model;
        workerRuntimeThinking = ctx.thinkingLevel;
        config.worker = { ...config.worker, provider: event.model.provider, model: modelId(event.model) };
      } else if (currentRole === "expert") {
        config.expert = { ...config.expert, selectionMode: "configured", provider: event.model.provider, model: modelId(event.model) };
      }
    }
    updateStatus(ctx);
  });

  pi.on("thinking_level_select", (event, ctx) => {
    activeCtx = ctx;
    if (!roleSwitchInProgress) {
      if (currentRole === "worker") {
        workerRuntimeThinking = event.level;
        if (config.worker.thinkingMode === "configured") config.worker.thinking = event.level;
      } else if (currentRole === "expert") {
        config.expert = { ...config.expert, thinkingMode: "configured", thinking: event.level };
      }
    }
    updateStatus(ctx);
  });

  async function applySetupResult(result, ctx) {
    if (!result || result.cancelled) return false;
    if (result.scope === "session") config = result.config;
    else loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
    validation = validateConfig(config);
    registerConfiguredProviders(pi, config, { onWarning: (message) => notify(ctx, message, "warning") });
    if (validation.errors.length) {
      notify(ctx, `Configuration errors: ${validation.errors.join("; ")}`, "error");
      return false;
    }
    if (!usesConfiguredModel(config.worker) && ctx.model) captureWorkerRuntime(ctx);
    const role = currentRole === "expert" && config.mode === "dual" ? "expert" : "worker";
    try { await activateRole(role, ctx, { quiet: true }); }
    catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "warning"); }
    notify(ctx, result.path ? `Settings saved to ${result.path}` : "Settings applied to this session", "info");
    if (result.loginProvider) prepareNativeLogin(ctx, result.loginProvider);
    updateStatus(ctx);
    return true;
  }

  async function openSetup(ctx) {
    ensureInitialized(ctx);
    return applySetupResult(await runCascadeSetup({ ctx, config }), ctx);
  }

  async function openRoleModelPicker(role, ctx) {
    ensureInitialized(ctx);
    const result = await runRoleModelPicker({ ctx, config, role });
    if (!result || result.cancelled) return false;
    config = result.config;
    if (result.scope !== "session") loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
    if (role === "worker" && !usesConfiguredModel(config.worker) && ctx.model) captureWorkerRuntime(ctx);
    try { if (currentRole === role || role === "worker") await activateRole(role, ctx, { quiet: true }); }
    catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "warning"); }
    notify(ctx, result.path ? `${role} model saved to ${result.path}` : `${role} model changed for this session`, "info");
    if (result.loginProvider) prepareNativeLogin(ctx, result.loginProvider);
    updateStatus(ctx);
    return true;
  }

  pi.registerCommand("cascade-setup", {
    description: "Configure Cascade in the TUI",
    async handler(_args, ctx) {
      try { await openSetup(ctx); }
      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    }
  });

  pi.registerCommand("cascade-worker", {
    description: "Choose the worker model",
    async handler(_args, ctx) {
      try { await openRoleModelPicker("worker", ctx); }
      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    }
  });

  pi.registerCommand("cascade-expert", {
    description: "Choose the expert model",
    async handler(_args, ctx) {
      try { await openRoleModelPicker("expert", ctx); }
      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    }
  });

  pi.registerCommand("cascade-auth", {
    description: "Prepare the native /login flow for a provider",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const requested = String(args || "").trim();
      const provider = requested || await chooseLoginProvider(ctx);
      if (provider) prepareNativeLogin(ctx, provider);
    }
  });

  pi.registerCommand("cascade-compaction", {
    description: "Configure global Cascade compaction limits",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      if (String(args || "").trim() === "show") {
        notify(ctx, JSON.stringify(getCascadeGlobalCompaction(), null, 2), "info");
        return;
      }
      try {
        const result = await runCompactionSetup(ctx);
        if (!result.cancelled) notify(ctx, `Global compaction settings saved to ${result.path}. Restart Cascade to apply them.`, "info");
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    }
  });

  pi.registerCommand("cascade", {
    description: "Show or reload Cascade status",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const [action] = parseWords(args);
      if (action === "setup") return await openSetup(ctx);
      if (action === "reload") {
        initialize(ctx);
        await activateRole(currentRole === "expert" && config.mode === "dual" ? "expert" : "worker", ctx, { quiet: true });
        notify(ctx, "Cascade configuration reloaded", "info");
      }
      const report = {
        version: PACKAGE_VERSION,
        mode: config.mode,
        currentRole,
        worker: config.worker,
        expert: config.mode === "dual" ? config.expert : undefined,
        route: router.snapshot(),
        totals: ledger.totals(),
        privacy: {
          classification: config.privacy.classification,
          worker: policyFor(usesConfiguredModel(config.worker) ? config.worker : activeModelConfig(ctx, config, "worker")),
          expert: config.mode === "dual" ? policyFor(config.expert) : undefined
        },
        harness: harness.manifest(),
        configSources,
        blockedReason: blockedReason || null
      };
      if (action === "details" || action === "json") {
        notify(ctx, JSON.stringify(report, null, 2), blockedReason ? "error" : "info");
      } else {
        const runtimeProvider = ctx.model?.provider;
        const runtimeModel = modelId(ctx.model);
        const runtimeLabel = !runtimeProvider || runtimeProvider === "unknown" || !runtimeModel || runtimeModel === "unknown"
          ? "not selected"
          : `${runtimeProvider}/${runtimeModel}`;
        const worker = usesConfiguredModel(config.worker)
          ? describeModel(config.worker)
          : `current Cascade model (${runtimeLabel})`;
        const expert = config.mode === "dual" ? describeModel(config.expert) : "disabled";
        const totals = report.totals;
        const route = report.route;
        notify(ctx, [
          `Cascade ${PACKAGE_VERSION}`,
          `Mode: ${config.mode} · active role: ${currentRole}`,
          `Worker: ${worker}`,
          `Expert: ${expert}`,
          `Route: ${route.level} (${Number(route.score || 0).toFixed(1)})`,
          `Usage: ${totals.expertCalls || 0} expert calls · $${Number(totals.estimatedTotalCostUsd || 0).toFixed(3)}`,
          `Privacy: ${config.privacy.classification} · Contributor ${config.privacy.allowContributor ? "allowed" : "blocked"}`,
          blockedReason ? `Attention: ${blockedReason}` : "Ready. Use /cascade-setup to change settings; /cascade details for JSON."
        ].join("\n"), blockedReason ? "error" : "info");
      }
      updateStatus(ctx);
    }
  });

  pi.registerCommand("cascade-mode", {
    description: "Switch Cascade between single and dual mode",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const [mode] = parseWords(args);
      if (!mode) return notify(ctx, `Current mode: ${config.mode}`, "info");
      if (!['single', 'dual'].includes(mode)) return notify(ctx, "Usage: /cascade-mode single|dual", "warning");
      config.mode = mode;
      if (mode === "single" && currentRole === "expert") await activateRole("worker", ctx);
      updateStatus(ctx);
      notify(ctx, `Cascade mode changed for this session to ${mode}`, "info");
    }
  });

  pi.registerCommand("cascade-role", {
    description: "Switch the active parent session between worker and expert profiles",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const [role] = parseWords(args);
      if (!['worker', 'expert'].includes(role)) return notify(ctx, "Usage: /cascade-role worker|expert", "warning");
      try { await activateRole(role, ctx); }
      catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    }
  });

  pi.registerCommand("cascade-consult", {
    description: "Run a bounded expert consultation with an evidence handoff",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const question = String(args || "").trim();
      if (!question) return notify(ctx, "Usage: /cascade-consult <concrete question>", "warning");
      try {
        const result = await performExpert({ question, mode: "consult", ctx, forced: true });
        pi.sendMessage({
          customType: "cascade.expert-manual",
          content: [{ type: "text", text: JSON.stringify(result.parsed, null, 2) }],
          display: true,
          details: result
        }, { triggerTurn: false });
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    }
  });

  pi.registerCommand("cascade-takeover", {
    description: "Run one explicitly authorized bounded expert takeover episode",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const question = String(args || "").trim() || "Take temporary ownership, resolve the current blocker, make the smallest justified patch, and verify it.";
      try {
        const result = await performExpert({ question, mode: "takeover", ctx, forced: true });
        pi.sendMessage({
          customType: "cascade.expert-takeover",
          content: [{ type: "text", text: JSON.stringify(result.parsed, null, 2) }],
          display: true,
          details: result
        }, { triggerTurn: true, deliverAs: "followUp" });
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    }
  });

  pi.registerCommand("cascade-evidence", {
    description: "Show recent evidence ledger entries",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const count = Math.min(100, Math.max(1, Number(parseWords(args)[0] || 20)));
      notify(ctx, JSON.stringify({ path: ledger.path, totals: ledger.totals(), entries: ledger.recent(count) }, null, 2), "info");
    }
  });

  pi.registerCommand("cascade-verify", {
    description: "Discover and run repository verification commands",
    async handler(_args, ctx) {
      ensureInitialized(ctx);
      const plan = discoverVerificationCommands(ctx.cwd, config.verification.commands);
      if (!plan.length) return notify(ctx, "No verification commands were discovered.", "warning");
      notify(ctx, formatVerificationPlan(plan), "info");
      const report = await runVerificationPlan(plan, { cwd: ctx.cwd, timeoutMs: config.verification.timeoutMs, signal: ctx.signal });
      ledger.record("verification_report", report, { status: report.ok ? "verified" : "falsified", summary: summarizeVerificationReport(report) });
      if (report.ok) {
        router.markProgress("verification passed");
        verifiedDiffKey = repositoryDiffKey(ctx.cwd).key;
        completionGateRuns = 0;
      } else router.addSignal("verifierFailure", config.routing.weights.verifierFailure, "cascade verification command failed");
      notify(ctx, summarizeVerificationReport(report), report.ok ? "info" : "error");
      updateStatus(ctx);
    }
  });

  pi.registerCommand("cascade-harness", {
    description: "Show harness entries or candidates",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const [kind = "entries"] = parseWords(args);
      const value = kind === "candidates" ? harness.listCandidates() : harness.listEntries();
      notify(ctx, JSON.stringify({ manifest: harness.manifest(), [kind]: value }, null, 2), "info");
    }
  });

  pi.registerCommand("cascade-refine", {
    description: "Ask the active model to create a scoped harness proposal",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const focus = String(args || "").trim();
      const template = proposalTemplate();
      pi.sendUserMessage(
        `Review the current trajectory for one repeated failure or reusable tactic${focus ? `, focusing on: ${focus}` : ""}. If a small harness change is justified, call cascade_refine with an evidence-backed proposal. Do not propose a broad rewrite. Template:\n${JSON.stringify(template, null, 2)}`,
        { deliverAs: "followUp" }
      );
    }
  });

  pi.registerCommand("cascade-canary", {
    description: "Activate a prompt/memory harness candidate for this session only, or clear canaries",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const [id] = parseWords(args);
      if (!id) return notify(ctx, "Usage: /cascade-canary <candidate-id>|off", "warning");
      try {
        const result = id === "off" ? harness.clearCanary() : harness.activateCanary(id);
        ledger.record("harness_canary", { id, result }, { status: "verified" });
        notify(ctx, id === "off" ? "Harness canaries cleared." : `Harness candidate ${id} activated as a session canary.`, "info");
        updateStatus(ctx);
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    }
  });

  pi.registerCommand("cascade-promote", {
    description: "Promote an evaluated harness candidate; add --force for explicit operator override",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const words = parseWords(args);
      const id = words.find((word) => !word.startsWith("--"));
      if (!id) return notify(ctx, "Usage: /cascade-promote <candidate-id> [--force]", "warning");
      try {
        const result = harness.promote(id, { force: words.includes("--force"), promotedBy: "interactive-operator" });
        ledger.record("harness_promotion", result, { status: "verified" });
        notify(ctx, `Promoted harness candidate ${id}. New manifest ${result.manifest.combinedHash}`, "info");
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    }
  });

  pi.registerCommand("cascade-rollback", {
    description: "Roll back a promoted harness candidate",
    async handler(args, ctx) {
      ensureInitialized(ctx);
      const [id] = parseWords(args);
      if (!id) return notify(ctx, "Usage: /cascade-rollback <candidate-id>", "warning");
      try {
        const result = harness.rollback(id, { rolledBackBy: "interactive-operator" });
        ledger.record("harness_rollback", result, { status: "verified" });
        notify(ctx, `Rolled back harness candidate ${id}.`, "info");
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    }
  });

  pi.registerCommand("cascade-privacy", {
    description: "Show endpoint privacy decisions and denied paths",
    async handler(_args, ctx) {
      ensureInitialized(ctx);
      notify(ctx, JSON.stringify({
        classification: config.privacy.classification,
        allowContributor: config.privacy.allowContributor,
        worker: policyFor(config.worker),
        expert: config.mode === "dual" ? policyFor(config.expert) : undefined,
        denyPaths: config.privacy.denyPaths
      }, null, 2), "info");
    }
  });
}
