import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { redactSecrets } from "./privacy.mjs";
import { nowIso, safeFileName, shortHash, truncateText } from "./util.mjs";

function storageRoot(config, cwd) {
  const explicit = process.env.CASCADE_STATE_DIR;
  if (explicit) return resolve(explicit);
  return join(homedir(), ".local", "state", "cascade", "sessions", shortHash(resolve(cwd), 16));
}

export function normalizeUsage(raw = {}) {
  const source = raw || {};
  const input = Number(source.input ?? source.inputTokens ?? source.promptTokens ?? source.prompt_tokens ?? 0);
  const output = Number(source.output ?? source.outputTokens ?? source.completionTokens ?? source.completion_tokens ?? 0);
  const cacheRead = Number(source.cacheRead ?? source.cacheReadTokens ?? source.cache_read_input_tokens ?? 0);
  const cacheWrite = Number(source.cacheWrite ?? source.cacheWriteTokens ?? source.cache_creation_input_tokens ?? 0);
  const reasoning = Number(source.reasoning ?? source.reasoningTokens ?? source.reasoning_tokens ?? 0);
  const total = Number(source.total ?? source.totalTokens ?? source.total_tokens ?? input + output + cacheRead + cacheWrite);
  const cost = Number(source.cost?.total ?? source.costUsd ?? source.totalCost ?? source.cost ?? 0);
  return { input, output, cacheRead, cacheWrite, reasoning, total, cost: Number.isFinite(cost) ? cost : 0 };
}

export function estimateUsageCost(usage, costRates = {}) {
  const normalized = normalizeUsage(usage);
  if (normalized.cost > 0) return normalized.cost;
  return (
    normalized.input * Number(costRates.input ?? 0) +
    normalized.output * Number(costRates.output ?? 0) +
    normalized.cacheRead * Number(costRates.cacheRead ?? 0) +
    normalized.cacheWrite * Number(costRates.cacheWrite ?? 0)
  ) / 1_000_000;
}

export class EvidenceLedger {
  constructor({ cwd, config, harnessManifest = {}, sessionId } = {}) {
    this.cwd = resolve(cwd);
    this.config = config;
    this.sessionId = String(sessionId || `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`);
    this.maximumMemoryEntries = 500;
    this.harnessManifest = harnessManifest;
    this.path = join(storageRoot(config, cwd), `${safeFileName(this.sessionId, shortHash(this.sessionId, 24))}.jsonl`);
    const existed = config.evidence.persist && existsSync(this.path);
    const persistedEntries = existed ? loadLedgerFile(this.path) : [];
    this.entries = persistedEntries.slice(-this.maximumMemoryEntries);
    this.expertCalls = 0;
    this.expertCostUsd = 0;
    this.workerCostUsd = 0;
    this.lastUserGoal = "";
    this.restoreDerivedState(persistedEntries);
    if (config.evidence.persist) mkdirSync(dirname(this.path), { recursive: true });
    this.record(existed ? "session_resume" : "session", {
      cwd: this.cwd,
      mode: config.mode,
      worker: config.worker,
      expert: config.expert,
      harnessManifest
    }, { status: "verified" });
  }

  restoreDerivedState(entries = this.entries) {
    for (const entry of entries) {
      if (entry.kind === "user_goal" && typeof entry.data?.text === "string") this.lastUserGoal = entry.data.text;
      if (entry.kind === "expert_consultation") {
        this.expertCalls += 1;
        this.expertCostUsd += Number(entry.data?.estimatedCostUsd || 0);
      }
      if (entry.kind === "model_usage") {
        const amount = Number(entry.data?.estimatedCostUsd || 0);
        if (entry.data?.role === "worker") this.workerCostUsd += amount;
        else if (entry.data?.role === "expert") this.expertCostUsd += amount;
      }
    }
  }

  record(kind, data = {}, options = {}) {
    const entry = {
      id: randomUUID(),
      at: nowIso(),
      kind,
      status: options.status || "unverified",
      summary: this.config.privacy.redactSecrets
        ? redactSecrets(options.summary || summarizeEntry(kind, data))
        : (options.summary || summarizeEntry(kind, data)),
      data: this.config.privacy.redactSecrets ? redactObject(data) : data
    };
    this.entries.push(entry);
    if (this.entries.length > this.maximumMemoryEntries) this.entries.splice(0, this.entries.length - this.maximumMemoryEntries);
    if (this.config.evidence.persist) appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
    return entry;
  }

  recordUserGoal(text) {
    this.lastUserGoal = truncateText(this.config.privacy.redactSecrets ? redactSecrets(text) : text, 12000);
    return this.record("user_goal", { text: this.lastUserGoal }, { status: "verified", summary: truncateText(text, 240) });
  }

  recordToolCall(toolName, input) {
    return this.record("tool_call", { toolName, input: sanitizeToolInput(input) }, { status: "unverified" });
  }

  recordToolResult(toolName, input, result, isError, details) {
    const output = extractTextContent(result);
    const shouldStoreRaw = this.config.privacy.storeRawToolOutput;
    const data = {
      toolName,
      input: sanitizeToolInput(input),
      isError: Boolean(isError),
      output: shouldStoreRaw ? truncateText(output, 16000) : truncateText(output, 1000),
      details: shouldStoreRaw ? details : compactDetails(details)
    };
    return this.record("tool_result", data, {
      status: isError ? "falsified" : "verified",
      summary: `${toolName}: ${isError ? "error" : "ok"} ${truncateText(output.replace(/\s+/g, " "), 180)}`
    });
  }

  recordExpertCall({ question, mode, model, result, usage, estimatedCostUsd, routeState }) {
    this.expertCalls += 1;
    this.expertCostUsd += Number(estimatedCostUsd || 0);
    return this.record("expert_consultation", {
      question: this.config.privacy.redactSecrets ? redactSecrets(question) : question,
      mode,
      model,
      result: truncateText(result, 24000),
      usage: normalizeUsage(usage),
      estimatedCostUsd,
      routeState
    }, { status: "verified", summary: `Expert ${mode}: ${truncateText(question, 180)}` });
  }

  recordAssistantUsage(role, usage, estimatedCostUsd = 0) {
    if (role === "worker") this.workerCostUsd += Number(estimatedCostUsd || 0);
    else this.expertCostUsd += Number(estimatedCostUsd || 0);
    return this.record("model_usage", { role, usage: normalizeUsage(usage), estimatedCostUsd }, { status: "verified" });
  }

  recent(limit = 80, predicate = () => true) {
    return this.entries.filter(predicate).slice(-limit);
  }

  latest(kind) {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index]?.kind === kind) return this.entries[index];
    }
    return undefined;
  }

  failures(limit = 20) {
    return this.recent(limit, (entry) => entry.kind === "tool_result" && entry.data?.isError);
  }

  totals() {
    return {
      expertCalls: this.expertCalls,
      expertCostUsd: this.expertCostUsd,
      workerCostUsd: this.workerCostUsd,
      estimatedTotalCostUsd: this.expertCostUsd + this.workerCostUsd,
      entries: this.entries.length
    };
  }

  buildEvidencePacket({ question, routeState, maximumCharacters, maximumEntries, harnessState, includeGitState = true }) {
    const packet = {
      schema: 1,
      sessionId: this.sessionId,
      goal: this.lastUserGoal,
      cwd: this.cwd,
      repository: includeGitState ? collectGitState(this.cwd) : undefined,
      routeState,
      harnessManifest: this.harnessManifest,
      harnessState,
      recentEvidence: this.recent(maximumEntries).map((entry) => ({
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        status: entry.status,
        summary: entry.summary,
        data: compactEvidenceData(entry.data)
      })),
      question: this.config.privacy.redactSecrets ? redactSecrets(question) : question,
      budgets: {
        ...this.totals(),
        maxExpertCalls: this.config.budgets.maxExpertCalls,
        maxExpertCostUsd: this.config.budgets.maxExpertCostUsd
      }
    };
    let json = JSON.stringify(packet, null, 2);
    if (json.length > maximumCharacters) {
      const keep = Math.max(8, Math.floor(maximumEntries / 2));
      packet.recentEvidence = packet.recentEvidence.slice(-keep);
      packet.truncated = true;
      json = JSON.stringify(packet, null, 2);
      if (json.length > maximumCharacters) {
        packet.recentEvidence = packet.recentEvidence.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          status: entry.status,
          summary: truncateText(entry.summary, 240)
        })).slice(-8);
        packet.harnessState = packet.harnessState?.manifest ? { manifest: packet.harnessState.manifest } : undefined;
        packet.repository = packet.repository ? {
          isGitRepository: packet.repository.isGitRepository,
          revision: packet.repository.revision,
          branch: packet.repository.branch,
          changedFileCount: packet.repository.changedFileCount,
          diffLines: packet.repository.diffLines,
          changedFiles: (packet.repository.changedFiles || []).slice(0, 40)
        } : undefined;
        packet.truncation = "Evidence data was compacted to preserve valid JSON within the configured handoff budget.";
        json = JSON.stringify(packet, null, 2);
      }
      if (json.length > maximumCharacters) {
        const minimal = {
          schema: packet.schema,
          sessionId: packet.sessionId,
          goal: truncateText(packet.goal, Math.max(400, Math.floor(maximumCharacters / 4))),
          routeState: packet.routeState,
          recentEvidence: packet.recentEvidence.slice(-4),
          question: truncateText(packet.question, 1000),
          budgets: packet.budgets,
          truncation: "Evidence packet reduced to a minimal valid JSON object."
        };
        json = JSON.stringify(minimal, null, 2);
      }
    }
    return { packet, json };
  }
}

function summarizeEntry(kind, data) {
  if (kind === "session") return `Session started in ${data.cwd}`;
  if (kind === "user_goal") return truncateText(data.text, 200);
  if (kind === "tool_call") return `${data.toolName} called`;
  if (kind === "model_usage") return `${data.role} usage recorded`;
  return kind;
}

function redactObject(value) {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:apiKey|authorization|password|secret|token)$/i.test(key)) result[key] = "[REDACTED]";
      else result[key] = redactObject(child);
    }
    return result;
  }
  return value;
}

function sanitizeToolInput(input) {
  if (!input || typeof input !== "object") return input;
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (/content|text/i.test(key) && typeof value === "string") result[key] = truncateText(value, 2000);
    else if (typeof value === "string") result[key] = truncateText(value, 4000);
    else result[key] = value;
  }
  return result;
}

function compactDetails(details) {
  if (!details || typeof details !== "object") return undefined;
  const allowed = ["exitCode", "signal", "truncated", "lineCount", "path", "durationMs", "command"];
  const result = {};
  for (const key of allowed) if (key in details) result[key] = details[key];
  return Object.keys(result).length ? result : undefined;
}

function compactEvidenceData(data) {
  if (!data || typeof data !== "object") return data;
  const clone = JSON.parse(JSON.stringify(data));
  if (typeof clone.output === "string") clone.output = truncateText(clone.output, 1200);
  if (typeof clone.result === "string") clone.result = truncateText(clone.result, 2500);
  return clone;
}

export function extractTextContent(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractTextContent).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) return extractTextContent(value.content);
    if (value.result !== undefined) return extractTextContent(value.result);
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function git(cwd, args, maximum = 20000) {
  try {
    return truncateText(execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), maximum);
  } catch {
    return "";
  }
}

export function collectGitState(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return { isGitRepository: false };
  const status = git(cwd, ["status", "--short"], 12000);
  const diffStat = git(cwd, ["diff", "--stat"], 12000);
  const diffNumstat = git(cwd, ["diff", "--numstat"], 12000);
  const stagedStat = git(cwd, ["diff", "--cached", "--stat"], 12000);
  const changedFiles = status ? status.split("\n").filter(Boolean).map((line) => line.slice(3).trim()) : [];
  let added = 0;
  let deleted = 0;
  for (const line of diffNumstat.split("\n")) {
    const [a, d] = line.split("\t");
    if (/^\d+$/.test(a)) added += Number(a);
    if (/^\d+$/.test(d)) deleted += Number(d);
  }
  return {
    isGitRepository: true,
    root,
    revision: git(cwd, ["rev-parse", "HEAD"]),
    branch: git(cwd, ["branch", "--show-current"]),
    remote: git(cwd, ["config", "--get", "remote.origin.url"]),
    status,
    changedFiles,
    changedFileCount: changedFiles.length,
    diffLines: added + deleted,
    diffStat,
    stagedStat
  };
}

export function loadLedgerFile(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
