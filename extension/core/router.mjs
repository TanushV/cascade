import { collectGitState, extractTextContent } from "./ledger.mjs";
import { clamp, shortHash, truncateText } from "./util.mjs";

const UNCERTAINTY_PATTERNS = [
  /\bnot sure\b/i,
  /\buncertain\b/i,
  /\bambiguous\b/i,
  /\bconflicting evidence\b/i,
  /\bunable to determine\b/i,
  /\bneed(?:s)? clarification\b/i,
  /\barchitecture(?:al)? decision\b/i
];

export class AdaptiveRouter {
  constructor(config) {
    this.config = config;
    this.turnIndex = 0;
    this.score = 0;
    this.signals = [];
    this.signatureCounts = new Map();
    this.consecutiveErrors = 0;
    this.lastProgressTurn = 0;
    this.lastConsultTurn = -Infinity;
    this.lastRecommendationTurn = -Infinity;
    this.activeVerifierCommand = "";
    this.currentToolCall = undefined;
  }

  onTurnStart(turnIndex) {
    this.turnIndex = Number(turnIndex ?? this.turnIndex + 1);
    this.score = Math.max(0, this.score * 0.85);
    this.signals = this.signals.filter((signal) => this.turnIndex - signal.turn <= 5);
  }

  onToolCall(toolName, input) {
    this.currentToolCall = { toolName, input };
    if (toolName === "bash") {
      const command = String(input?.command || "");
      this.activeVerifierCommand = this.isVerifierCommand(command) ? command : "";
    } else {
      this.activeVerifierCommand = "";
    }
  }

  onToolResult({ toolName, input, result, isError }) {
    const output = extractTextContent(result);
    const command = toolName === "bash" ? String(input?.command || this.currentToolCall?.input?.command || "") : "";
    const resultLooksFailed = Boolean(isError) || inferFailureFromOutput(output);
    if (resultLooksFailed) {
      this.consecutiveErrors += 1;
      this.addSignal("toolError", this.config.routing.weights.toolError, `${toolName} failed`);
      const signature = failureSignature(toolName, command, output);
      const count = (this.signatureCounts.get(signature) || 0) + 1;
      this.signatureCounts.set(signature, count);
      if (count > 1) {
        this.addSignal(
          "repeatedError",
          this.config.routing.weights.repeatedError * Math.min(2, count - 1),
          `failure signature repeated ${count} times`
        );
      }
      if (toolName === "bash" && this.isVerifierCommand(command)) {
        this.addSignal("verifierFailure", this.config.routing.weights.verifierFailure, `verification failed: ${truncateText(command, 120)}`);
      }
    } else {
      this.consecutiveErrors = 0;
      if (["edit", "write"].includes(toolName) || (toolName === "bash" && /\b(?:mv|cp|mkdir|git apply|patch)\b/.test(command))) {
        this.markProgress(`${toolName} completed`);
      } else {
        this.score = Math.max(0, this.score - 0.25);
      }
    }
    this.currentToolCall = undefined;
    return this.snapshot();
  }

  onAssistantMessage(message) {
    const text = extractTextContent(message?.content ?? message);
    if (UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(text))) {
      this.addSignal("explicitUncertainty", this.config.routing.weights.explicitUncertainty, "worker expressed uncertainty");
    }
  }

  addProtectedPathSignal(path) {
    this.addSignal("protectedPath", this.config.routing.weights.protectedPath, `protected path touched: ${path}`);
  }

  markProgress(reason = "progress") {
    this.lastProgressTurn = this.turnIndex;
    this.score = Math.max(0, this.score - 1.5);
    this.signals.push({ type: "progress", weight: -1.5, reason, turn: this.turnIndex });
  }

  addSignal(type, weight, reason) {
    const numeric = Number(weight || 0);
    this.score = clamp(this.score + numeric, 0, 100);
    this.signals.push({ type, weight: numeric, reason, turn: this.turnIndex });
  }

  refreshRepositorySignals(cwd) {
    const repository = collectGitState(cwd);
    if (!repository.isGitRepository) return repository;
    const largeDiff = repository.diffLines >= Number(this.config.routing.largeDiffLines || Infinity);
    const manyFiles = repository.changedFileCount >= Number(this.config.routing.manyFiles || Infinity);
    if (largeDiff && !this.hasRecentSignal("largeDiff")) {
      this.addSignal("largeDiff", this.config.routing.weights.largeDiff, `${repository.diffLines} changed lines`);
    }
    if (manyFiles && !this.hasRecentSignal("manyFiles")) {
      this.addSignal("manyFiles", this.config.routing.weights.manyFiles, `${repository.changedFileCount} changed files`);
    }
    if (this.turnIndex - this.lastProgressTurn >= 3 && this.consecutiveErrors > 0 && !this.hasRecentSignal("staleProgress")) {
      this.addSignal("staleProgress", this.config.routing.weights.staleProgress, "errors continue without recorded progress");
    }
    return repository;
  }

  hasRecentSignal(type) {
    return this.signals.some((signal) => signal.type === type && this.turnIndex - signal.turn <= 2);
  }

  isVerifierCommand(command) {
    const normalized = String(command).toLowerCase();
    return (this.config.routing.failureCommands || []).some((candidate) => normalized.includes(String(candidate).toLowerCase()));
  }

  level() {
    const { recommend, consult, takeover } = this.config.routing.thresholds;
    if (this.score >= takeover) return "takeover";
    if (this.score >= consult) return "consult";
    if (this.score >= recommend) return "recommend";
    return "worker";
  }

  canConsult(ledger, { ignoreCooldown = false } = {}) {
    if (!this.config.routing.enabled || this.config.mode !== "dual") return { allowed: false, reason: "dual routing disabled" };
    if (!ignoreCooldown && this.turnIndex - this.lastConsultTurn < this.config.routing.cooldownTurns) {
      return { allowed: false, reason: "consultation cooldown" };
    }
    const totals = ledger.totals();
    if (totals.expertCalls >= this.config.budgets.maxExpertCalls) return { allowed: false, reason: "expert call budget exhausted" };
    if (totals.expertCostUsd >= this.config.budgets.maxExpertCostUsd) return { allowed: false, reason: "expert cost budget exhausted" };
    if (totals.estimatedTotalCostUsd >= this.config.budgets.maxSessionEstimatedCostUsd) {
      return { allowed: false, reason: "session cost budget exhausted" };
    }
    return { allowed: true };
  }

  shouldAutoConsult(ledger) {
    if (!this.config.routing.autoConsult) return { consult: false, reason: "automatic consultation disabled" };
    if (this.level() !== "consult" && this.level() !== "takeover") return { consult: false, reason: "route score below consult threshold" };
    const admission = this.canConsult(ledger);
    return { consult: admission.allowed, reason: admission.reason || this.level() };
  }

  markConsulted() {
    this.lastConsultTurn = this.turnIndex;
    this.score = Math.max(0, this.score - 2);
  }

  shouldInjectRecommendation() {
    if (!this.config.routing.injectRecommendation || this.level() === "worker") return false;
    if (this.turnIndex - this.lastRecommendationTurn < this.config.routing.cooldownTurns) return false;
    this.lastRecommendationTurn = this.turnIndex;
    return true;
  }

  recommendation() {
    const snapshot = this.snapshot();
    const latest = snapshot.signals.slice(-4).map((signal) => signal.reason).join("; ");
    if (snapshot.level === "takeover") {
      return `Cascade route signal: expert takeover is justified (score ${snapshot.score.toFixed(1)}). Consult the expert now; switch models only if the expert recommends ownership. Evidence: ${latest}`;
    }
    if (snapshot.level === "consult") {
      return `Cascade route signal: consult the configured expert before another broad attempt (score ${snapshot.score.toFixed(1)}). Evidence: ${latest}`;
    }
    return `Cascade route signal: uncertainty is rising (score ${snapshot.score.toFixed(1)}). Consider a focused expert consultation if the next check does not resolve it. Evidence: ${latest}`;
  }


  restore(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return this.snapshot();
    this.turnIndex = Number(snapshot.turnIndex || 0);
    this.score = clamp(Number(snapshot.score || 0), 0, 100);
    this.consecutiveErrors = Math.max(0, Number(snapshot.consecutiveErrors || 0));
    this.lastProgressTurn = Math.max(0, Number(snapshot.lastProgressTurn || 0));
    this.lastConsultTurn = snapshot.lastConsultTurn === null || snapshot.lastConsultTurn === undefined
      ? -Infinity
      : Number(snapshot.lastConsultTurn);
    this.signals = Array.isArray(snapshot.signals)
      ? snapshot.signals.slice(-12).map((signal) => ({
          type: String(signal.type || "restored"),
          weight: Number(signal.weight || 0),
          reason: String(signal.reason || "restored route signal"),
          turn: Number(signal.turn || this.turnIndex)
        }))
      : [];
    return this.snapshot();
  }

  snapshot() {
    return {
      turnIndex: this.turnIndex,
      score: Number(this.score.toFixed(3)),
      level: this.level(),
      consecutiveErrors: this.consecutiveErrors,
      lastProgressTurn: this.lastProgressTurn,
      lastConsultTurn: Number.isFinite(this.lastConsultTurn) ? this.lastConsultTurn : null,
      signals: this.signals.slice(-12)
    };
  }
}

function failureSignature(toolName, command, output) {
  const normalizedOutput = String(output)
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\/[^\s:]+/g, "<path>")
    .replace(/\s+/g, " ")
    .slice(0, 800);
  return shortHash(`${toolName}\n${command}\n${normalizedOutput}`, 20);
}

function inferFailureFromOutput(output) {
  const text = String(output || "");
  return /(?:^|\n)(?:error|failed|failure|fatal|traceback|test[s]? failed)\b/i.test(text) || /\bexit code\s*[1-9]\d*\b/i.test(text);
}
