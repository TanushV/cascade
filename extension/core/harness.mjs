import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { atomicWriteJson, deepClone, nowIso, shortHash, stableStringify, truncateText } from "./util.mjs";

const HARNESS_SCHEMA = 1;
const KINDS = new Set(["prompt", "memory", "skill", "subagent"]);
const ACTIONS = new Set(["create", "update", "delete"]);
const SCOPES = new Set(["session", "repository", "model-pair", "ecosystem", "global"]);

function emptyState(scope) {
  return {
    schema: HARNESS_SCHEMA,
    scope,
    revision: 0,
    updatedAt: nowIso(),
    entries: {},
    history: []
  };
}

function emptyCandidateState() {
  return { schema: HARNESS_SCHEMA, candidates: {} };
}

function stateRoot(cwd) {
  const explicit = process.env.CASCADE_STATE_DIR;
  if (explicit) return resolve(explicit);
  return join(homedir(), ".local", "state", "cascade");
}

function repositoryKey(cwd) {
  return shortHash(resolve(cwd), 20);
}

function modelPairKey(config) {
  return shortHash(
    `${config.worker?.provider || ""}/${config.worker?.model || ""}|${config.expert?.provider || ""}/${config.expert?.model || ""}`,
    20
  );
}

function scopePath({ cwd, config, scope, sessionId }) {
  const root = stateRoot(cwd);
  switch (scope) {
    case "global":
      return join(root, "harness", "global.json");
    case "model-pair":
      return join(root, "harness", "model-pairs", `${modelPairKey(config)}.json`);
    case "ecosystem":
      return join(root, "harness", "ecosystems", `${detectEcosystem(cwd)}.json`);
    case "session":
      return join(root, "harness", "sessions", `${sessionId || "ephemeral"}.json`);
    case "repository":
    default:
      return join(root, "harness", "repositories", `${repositoryKey(cwd)}.json`);
  }
}

function candidatePath({ cwd }) {
  return join(stateRoot(cwd), "harness", "candidates.json");
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return deepClone(fallback);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : deepClone(fallback);
  } catch {
    return deepClone(fallback);
  }
}

function normalizeEntry(entry, fallbackScope) {
  return {
    id: String(entry.id || randomUUID()),
    kind: KINDS.has(entry.kind) ? entry.kind : "memory",
    title: String(entry.title || "Untitled harness entry"),
    content: String(entry.content || ""),
    path: String(entry.path || "general"),
    scope: SCOPES.has(entry.scope) ? entry.scope : fallbackScope,
    version: Math.max(1, Number(entry.version || 1)),
    status: entry.status === "retired" ? "retired" : "active",
    sourceEvidenceIds: Array.isArray(entry.sourceEvidenceIds) ? entry.sourceEvidenceIds.map(String) : [],
    metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
    createdAt: String(entry.createdAt || nowIso()),
    updatedAt: String(entry.updatedAt || nowIso()),
    lastUsedAt: entry.lastUsedAt ? String(entry.lastUsedAt) : undefined,
    useCount: Number(entry.useCount || 0)
  };
}

function normalizeState(raw, scope) {
  const state = emptyState(scope);
  state.revision = Number(raw?.revision || 0);
  state.updatedAt = String(raw?.updatedAt || nowIso());
  state.history = Array.isArray(raw?.history) ? raw.history.slice(-200) : [];
  for (const [id, entry] of Object.entries(raw?.entries || {})) {
    state.entries[id] = normalizeEntry({ ...entry, id }, scope);
  }
  return state;
}

function detectEcosystem(cwd) {
  const checks = [
    ["package.json", "javascript"],
    ["pyproject.toml", "python"],
    ["Cargo.toml", "rust"],
    ["go.mod", "go"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["Gemfile", "ruby"]
  ];
  for (const [file, label] of checks) {
    if (existsSync(join(cwd, file))) return label;
  }
  return "generic";
}

export function validateRefinementProposal(proposal) {
  const errors = [];
  if (!proposal || typeof proposal !== "object") return ["proposal must be an object"];
  if (!proposal.summary || typeof proposal.summary !== "string") errors.push("summary is required");
  if (!Array.isArray(proposal.edits) || proposal.edits.length === 0) errors.push("at least one edit is required");
  for (const [index, edit] of (proposal.edits || []).entries()) {
    if (!ACTIONS.has(edit.action)) errors.push(`edits[${index}].action is invalid`);
    if (!KINDS.has(edit.kind)) errors.push(`edits[${index}].kind is invalid`);
    if (edit.action !== "delete") {
      if (!edit.title || typeof edit.title !== "string") errors.push(`edits[${index}].title is required`);
      if (!edit.content || typeof edit.content !== "string") errors.push(`edits[${index}].content is required`);
    }
    if ((edit.action === "update" || edit.action === "delete") && !edit.id) {
      errors.push(`edits[${index}].id is required for ${edit.action}`);
    }
  }
  return errors;
}

export class HarnessStore {
  constructor({ cwd, config, sessionId }) {
    this.cwd = resolve(cwd);
    this.config = config;
    this.sessionId = sessionId;
    this.scopeOrder = ["global", "ecosystem", "model-pair", "repository", "session"];
    this.states = new Map();
    for (const scope of this.scopeOrder) {
      const path = scopePath({ cwd: this.cwd, config, scope, sessionId });
      this.states.set(scope, {
        path,
        state: normalizeState(loadJson(path, emptyState(scope)), scope)
      });
    }
    this.candidatesPath = candidatePath({ cwd: this.cwd });
    const rawCandidates = loadJson(this.candidatesPath, emptyCandidateState());
    this.candidates = rawCandidates?.candidates && typeof rawCandidates.candidates === "object"
      ? rawCandidates.candidates
      : {};
    this.canaryCandidateIds = new Set();
    const configuredCanaries = String(process.env.CASCADE_CANARY_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const candidateId of configuredCanaries) {
      const candidate = this.candidates[candidateId];
      if (!candidate || !["proposed", "evaluated"].includes(candidate.status)) continue;
      if ((candidate.edits || []).every((edit) => ["prompt", "memory"].includes(edit.kind))) {
        this.canaryCandidateIds.add(candidateId);
      }
    }
  }

  saveScope(scope) {
    const item = this.states.get(scope);
    if (!item) throw new Error(`Unknown harness scope: ${scope}`);
    item.state.updatedAt = nowIso();
    mkdirSync(dirname(item.path), { recursive: true });
    atomicWriteJson(item.path, item.state);
  }

  saveCandidates() {
    atomicWriteJson(this.candidatesPath, { schema: HARNESS_SCHEMA, candidates: this.candidates });
  }

  activeEntries({ includeKinds = ["prompt", "memory"], markUsed = false } = {}) {
    const include = new Set(includeKinds);
    const byComposite = new Map();
    for (const scope of this.scopeOrder) {
      const state = this.states.get(scope).state;
      for (const entry of Object.values(state.entries)) {
        if (entry.status !== "active" || !include.has(entry.kind)) continue;
        const key = `${entry.kind}:${entry.path}:${entry.title.toLowerCase()}`;
        byComposite.set(key, { ...entry, scope });
      }
    }
    const entries = [...byComposite.values()];
    if (markUsed) {
      const touched = new Set();
      for (const entry of entries) {
        const state = this.states.get(entry.scope).state;
        const actual = state.entries[entry.id];
        if (!actual) continue;
        actual.lastUsedAt = nowIso();
        actual.useCount = Number(actual.useCount || 0) + 1;
        touched.add(entry.scope);
      }
      for (const scope of touched) this.saveScope(scope);
    }
    return entries;
  }

  promptOverlay() {
    if (this.config.harnessLearning.mode === "off") return "";
    const entries = this.activeEntries({ includeKinds: ["prompt", "memory"], markUsed: false });
    for (const candidateId of this.canaryCandidateIds) {
      const candidate = this.candidates[candidateId];
      if (!candidate) continue;
      for (const edit of candidate.edits || []) {
        if (edit.action === "delete" || !["prompt", "memory"].includes(edit.kind)) continue;
        entries.push({
          id: `canary:${candidate.id}:${edit.id || edit.title}`,
          scope: `canary/${candidate.scope}`,
          kind: edit.kind,
          title: edit.title || "Canary harness entry",
          content: edit.content || "",
          path: edit.path || "general",
          version: 0
        });
      }
    }
    const prompts = entries.filter((entry) => entry.kind === "prompt").slice(-this.config.harnessLearning.maxPromptEntries);
    const memories = entries.filter((entry) => entry.kind === "memory").slice(-this.config.harnessLearning.maxMemoryEntries);
    if (prompts.length === 0 && memories.length === 0) return "";
    const lines = ["# Cascade scoped harness", ""];
    if (prompts.length) {
      lines.push("## Behavioral overlays");
      for (const entry of prompts) lines.push(`- [${entry.scope}:${entry.id}@v${entry.version}] ${entry.content}`);
      lines.push("");
    }
    if (memories.length) {
      lines.push("## Relevant durable observations");
      for (const entry of memories) lines.push(`- [${entry.scope}:${entry.id}@v${entry.version}] ${entry.title}: ${entry.content}`);
    }
    return truncateText(lines.join("\n"), this.config.harnessLearning.maxPromptCharacters);
  }

  manifest() {
    const scopes = {};
    for (const [scope, item] of this.states) {
      scopes[scope] = {
        revision: item.state.revision,
        activeEntries: Object.values(item.state.entries).filter((entry) => entry.status === "active").length,
        hash: shortHash(stableStringify(item.state.entries), 16)
      };
    }
    return {
      schema: HARNESS_SCHEMA,
      mode: this.config.harnessLearning.mode,
      scopes,
      canaryCandidateIds: [...this.canaryCandidateIds],
      combinedHash: shortHash(stableStringify({ scopes, canary: [...this.canaryCandidateIds] }), 20)
    };
  }

  propose(proposal, { scope = this.config.harnessLearning.scope || "repository", evidenceIds = [], createdBy = "model" } = {}) {
    if (!SCOPES.has(scope)) throw new Error(`Invalid harness scope: ${scope}`);
    const errors = validateRefinementProposal(proposal);
    if (errors.length) throw new Error(`Invalid harness proposal: ${errors.join("; ")}`);
    const id = randomUUID();
    const now = nowIso();
    const candidate = {
      id,
      schema: HARNESS_SCHEMA,
      scope,
      summary: proposal.summary,
      rationale: String(proposal.rationale || ""),
      expectedOutcome: String(proposal.expectedOutcome || ""),
      predictedRegressions: Array.isArray(proposal.predictedRegressions) ? proposal.predictedRegressions.map(String) : [],
      edits: proposal.edits.map((edit) => ({
        action: edit.action,
        kind: edit.kind,
        id: edit.id ? String(edit.id) : undefined,
        title: edit.title ? String(edit.title) : undefined,
        content: edit.content ? String(edit.content) : undefined,
        path: edit.path ? String(edit.path) : "general",
        metadata: edit.metadata && typeof edit.metadata === "object" ? edit.metadata : {},
        reason: String(edit.reason || "")
      })),
      evidenceIds: [...new Set([...evidenceIds, ...(proposal.evidenceIds || [])].map(String))],
      createdBy,
      createdAt: now,
      updatedAt: now,
      status: "proposed",
      evaluation: undefined,
      appliedChange: undefined
    };
    this.candidates[id] = candidate;
    this.saveCandidates();
    return deepClone(candidate);
  }

  evaluate(candidateId, metrics) {
    const candidate = this.requireCandidate(candidateId);
    const normalized = {
      taskCount: Number(metrics.taskCount || 0),
      qualityDelta: Number(metrics.qualityDelta || 0),
      costDelta: Number(metrics.costDelta || 0),
      latencyDelta: Number(metrics.latencyDelta || 0),
      expertCallRateDelta: Number(metrics.expertCallRateDelta || 0),
      complexityDelta: Number(metrics.complexityDelta || 0),
      deterministicChecksPassed: Boolean(metrics.deterministicChecksPassed),
      expertReviewed: Boolean(metrics.expertReviewed),
      notes: String(metrics.notes || ""),
      evaluatedAt: nowIso()
    };
    candidate.evaluation = normalized;
    candidate.status = "evaluated";
    candidate.updatedAt = nowIso();
    this.saveCandidates();
    return { candidate: deepClone(candidate), admission: this.promotionAdmission(candidate) };
  }

  promotionAdmission(candidateOrId, { force = false } = {}) {
    const candidate = typeof candidateOrId === "string" ? this.requireCandidate(candidateOrId) : candidateOrId;
    if (force) return { allowed: true, reasons: ["forced by operator"] };
    const reasons = [];
    const evaluation = candidate.evaluation;
    if (this.config.harnessLearning.requireReplayForPromotion && !evaluation) reasons.push("replay evaluation is required");
    if (evaluation) {
      const limits = this.config.harnessLearning.promotion || {};
      if (!evaluation.deterministicChecksPassed) reasons.push("deterministic checks did not pass");
      if (evaluation.taskCount < Number(limits.minimumTaskCount ?? 1)) {
        reasons.push(`evaluation requires at least ${Number(limits.minimumTaskCount ?? 1)} tasks`);
      }
      if (evaluation.qualityDelta < -Number(limits.maximumQualityRegression ?? 0)) reasons.push("quality regressed beyond the configured limit");
      if (evaluation.costDelta > Number(limits.maximumCostIncrease ?? 0.05)) reasons.push("cost increased beyond the configured limit");
      if (evaluation.latencyDelta > Number(limits.maximumLatencyIncrease ?? 0.10)) reasons.push("latency increased beyond the configured limit");
      if (evaluation.expertCallRateDelta > Number(limits.maximumExpertCallRateIncrease ?? 0.05)) reasons.push("expert-call rate increased beyond the configured limit");
      if (evaluation.complexityDelta > Number(limits.maximumComplexityIncrease ?? 0.10)) reasons.push("harness complexity increased beyond the configured limit");
    }
    if (candidate.scope === "global" && this.config.harnessLearning.requireExpertReviewForGlobal) {
      const reviewed = candidate.evaluation?.expertReviewed === true || candidate.expertReview?.approved === true;
      if (!reviewed) reasons.push("global promotion requires expert review");
    }
    return { allowed: reasons.length === 0, reasons };
  }

  promote(candidateId, { force = false, promotedBy = "operator" } = {}) {
    const candidate = this.requireCandidate(candidateId);
    if (["promoted", "rolled-back"].includes(candidate.status)) throw new Error(`Candidate ${candidateId} is already ${candidate.status}`);
    const admission = this.promotionAdmission(candidate, { force });
    if (!admission.allowed) throw new Error(`Candidate cannot be promoted: ${admission.reasons.join("; ")}`);
    const item = this.states.get(candidate.scope);
    if (!item) throw new Error(`No state store for scope ${candidate.scope}`);
    const before = deepClone(item.state);
    const changedIds = [];
    for (const edit of candidate.edits) {
      if (edit.action === "create") {
        const id = edit.id || randomUUID();
        item.state.entries[id] = normalizeEntry({
          id,
          kind: edit.kind,
          title: edit.title,
          content: edit.content,
          path: edit.path,
          scope: candidate.scope,
          version: 1,
          sourceEvidenceIds: candidate.evidenceIds,
          metadata: edit.metadata,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }, candidate.scope);
        changedIds.push(id);
      } else if (edit.action === "update") {
        const existing = item.state.entries[edit.id];
        if (!existing) throw new Error(`Cannot update missing harness entry ${edit.id}`);
        item.state.entries[edit.id] = normalizeEntry({
          ...existing,
          title: edit.title,
          content: edit.content,
          path: edit.path,
          metadata: { ...existing.metadata, ...edit.metadata },
          version: existing.version + 1,
          updatedAt: nowIso(),
          sourceEvidenceIds: [...new Set([...(existing.sourceEvidenceIds || []), ...candidate.evidenceIds])]
        }, candidate.scope);
        changedIds.push(edit.id);
      } else if (edit.action === "delete") {
        const existing = item.state.entries[edit.id];
        if (!existing) throw new Error(`Cannot delete missing harness entry ${edit.id}`);
        existing.status = "retired";
        existing.version += 1;
        existing.updatedAt = nowIso();
        changedIds.push(edit.id);
      }
    }
    item.state.revision += 1;
    const changeId = randomUUID();
    item.state.history.push({
      id: changeId,
      candidateId,
      summary: candidate.summary,
      changedIds,
      promotedBy,
      before,
      at: nowIso()
    });
    item.state.history = item.state.history.slice(-100);
    this.saveScope(candidate.scope);
    this.canaryCandidateIds.delete(candidateId);
    candidate.status = "promoted";
    candidate.updatedAt = nowIso();
    candidate.appliedChange = { changeId, changedIds, revision: item.state.revision };
    this.saveCandidates();
    return { candidate: deepClone(candidate), manifest: this.manifest() };
  }

  rollback(candidateId, { rolledBackBy = "operator" } = {}) {
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status !== "promoted" || !candidate.appliedChange?.changeId) {
      throw new Error(`Candidate ${candidateId} has no promoted change to roll back`);
    }
    const item = this.states.get(candidate.scope);
    const historyIndex = item.state.history.findIndex((event) => event.id === candidate.appliedChange.changeId);
    if (historyIndex < 0) throw new Error(`Rollback snapshot for ${candidateId} is unavailable`);
    const event = item.state.history[historyIndex];
    const restored = normalizeState(event.before, candidate.scope);
    restored.revision = Math.max(item.state.revision + 1, restored.revision + 1);
    restored.history = item.state.history.slice(0, historyIndex + 1);
    restored.history.push({
      id: randomUUID(),
      rollbackOf: event.id,
      candidateId,
      rolledBackBy,
      at: nowIso()
    });
    item.state = restored;
    this.states.set(candidate.scope, item);
    this.saveScope(candidate.scope);
    candidate.status = "rolled-back";
    candidate.updatedAt = nowIso();
    this.saveCandidates();
    return { candidate: deepClone(candidate), manifest: this.manifest() };
  }

  retireUnused({ now = Date.now() } = {}) {
    const days = Number(this.config.harnessLearning.retirementDays || 0);
    if (days <= 0) return [];
    const cutoff = now - days * 86_400_000;
    const retired = [];
    for (const scope of this.scopeOrder) {
      const item = this.states.get(scope);
      let changed = false;
      for (const entry of Object.values(item.state.entries)) {
        if (entry.status !== "active") continue;
        const time = new Date(entry.lastUsedAt || entry.updatedAt || entry.createdAt).getTime();
        if (Number.isFinite(time) && time < cutoff && entry.useCount === 0) {
          entry.status = "retired";
          entry.version += 1;
          entry.updatedAt = nowIso();
          retired.push({ scope, id: entry.id, title: entry.title });
          changed = true;
        }
      }
      if (changed) {
        item.state.revision += 1;
        this.saveScope(scope);
      }
    }
    return retired;
  }

  activateCanary(candidateId) {
    const candidate = this.requireCandidate(candidateId);
    if (!["proposed", "evaluated"].includes(candidate.status)) {
      throw new Error(`Candidate ${candidateId} cannot enter canary from status ${candidate.status}`);
    }
    if ((candidate.edits || []).some((edit) => !["prompt", "memory"].includes(edit.kind))) {
      throw new Error("Canary activation is limited to prompt and memory entries");
    }
    this.canaryCandidateIds.add(candidateId);
    candidate.lastCanaryAt = nowIso();
    return { candidate: deepClone(candidate), manifest: this.manifest() };
  }

  clearCanary(candidateId) {
    if (candidateId) {
      this.canaryCandidateIds.delete(candidateId);
    } else {
      this.canaryCandidateIds.clear();
    }
    return this.manifest();
  }

  listCandidates({ status } = {}) {
    return Object.values(this.candidates)
      .filter((candidate) => !status || candidate.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(deepClone);
  }

  listEntries() {
    const result = [];
    for (const scope of this.scopeOrder) {
      for (const entry of Object.values(this.states.get(scope).state.entries)) result.push({ ...deepClone(entry), scope });
    }
    return result;
  }

  requireCandidate(id) {
    const candidate = this.candidates[id];
    if (!candidate) throw new Error(`Harness candidate not found: ${id}`);
    return candidate;
  }
}

export function proposalTemplate() {
  return {
    summary: "Small evidence-backed harness improvement",
    rationale: "Describe the repeated failure or reusable tactic",
    expectedOutcome: "Describe how replay should validate the change",
    predictedRegressions: [],
    evidenceIds: [],
    edits: [
      {
        action: "create",
        kind: "memory",
        title: "Descriptive title",
        content: "Durable observation",
        path: "repository",
        metadata: {},
        reason: "Why this is useful"
      }
    ]
  };
}
