import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { CONTRIBUTOR_CLASSIFICATIONS_ALLOWED_BY_DEFAULT } from "./defaults.mjs";

function escapeRegExp(text) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(glob) {
  let pattern = "";
  const normalized = String(glob).replaceAll("\\", "/");
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          pattern += "(?:.*/)?";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(char);
    }
  }
  return new RegExp(`(?:^|/)${pattern}(?:$|/)`, "i");
}

export function normalizeRepositoryPath(cwd, candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return "";
  const absolute = resolve(cwd, candidate);
  const rel = relative(resolve(cwd), absolute);
  if (rel.startsWith("..") || rel === "") return rel.replaceAll(sep, "/");
  return rel.replaceAll(sep, "/");
}

export function isDeniedPath(cwd, candidate, denyPatterns) {
  const normalized = normalizeRepositoryPath(cwd, candidate);
  if (!normalized || normalized.startsWith("..")) return normalized.startsWith("..");
  return (denyPatterns || []).some((pattern) => globToRegExp(pattern).test(normalized));
}

export function isContributorModel(modelConfig, pattern = "contributor") {
  const value = `${modelConfig?.provider || ""}/${modelConfig?.model || ""}`.toLowerCase();
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return value.includes(String(pattern).toLowerCase());
  }
}

export function evaluateContributorPolicy(config, modelConfig) {
  if (!isContributorModel(modelConfig, config.privacy.contributorPattern)) {
    return { allowed: true, contributor: false, reason: "not a contributor endpoint" };
  }
  const classification = config.privacy.classification || "unknown";
  if (!config.privacy.allowContributor) {
    return {
      allowed: false,
      contributor: true,
      reason: "privacy.allowContributor is false; explicit repository consent is required"
    };
  }
  if (!CONTRIBUTOR_CLASSIFICATIONS_ALLOWED_BY_DEFAULT.has(classification)) {
    return {
      allowed: false,
      contributor: true,
      reason: `contributor endpoints are not permitted for repository classification ${classification}`
    };
  }
  return { allowed: true, contributor: true, reason: `explicitly allowed for ${classification} repository` };
}

export function detectGitRepository(cwd) {
  const result = {
    isGitRepository: false,
    root: resolve(cwd),
    remote: "",
    branch: "",
    revision: "",
    visibility: "unknown"
  };
  const run = (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    result.root = run(["rev-parse", "--show-toplevel"]);
    result.isGitRepository = true;
  } catch {
    return result;
  }
  try { result.remote = run(["config", "--get", "remote.origin.url"]); } catch {}
  try { result.branch = run(["branch", "--show-current"]); } catch {}
  try { result.revision = run(["rev-parse", "HEAD"]); } catch {}
  if (/github\.com[:/].+\/.+/i.test(result.remote)) result.visibility = "unverified-github";
  return result;
}

const SECRET_PATTERNS = [
  [/(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, "[REDACTED_API_KEY]"],
  [/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, "Bearer [REDACTED_TOKEN]"],
  [/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']{8,}/gi, "$1=[REDACTED]"],
  [/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/[A-Za-z0-9+/]{40,}={0,2}/g, (match) => match.length > 96 ? "[REDACTED_HIGH_ENTROPY_VALUE]" : match]
];

export function redactSecrets(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

function extractCandidatePaths(toolName, input) {
  if (!input || typeof input !== "object") return [];
  if (["read", "edit", "write", "grep", "find", "ls"].includes(toolName)) {
    return [input.path, input.file, input.directory].filter((value) => typeof value === "string");
  }
  return [];
}

export function inspectToolCallForPrivacy({ toolName, input, cwd, config }) {
  const denyPatterns = config.privacy.denyPaths || [];
  for (const candidate of extractCandidatePaths(toolName, input)) {
    if (isDeniedPath(cwd, candidate, denyPatterns)) {
      return { blocked: true, reason: `Pi Cascade privacy policy blocks ${toolName} on ${candidate}` };
    }
  }

  if (toolName === "bash" && config.privacy.blockSuspiciousBash) {
    const command = String(input?.command || "");
    const normalized = command.replaceAll("\\", "/");
    for (const pattern of denyPatterns) {
      const literal = pattern.replaceAll("**/", "").replaceAll("**", "").replaceAll("*", "");
      if (literal && normalized.toLowerCase().includes(literal.toLowerCase())) {
        return { blocked: true, reason: `Pi Cascade privacy policy blocks a bash command referencing ${pattern}` };
      }
    }
    if (/\b(?:env|printenv|set)\b/i.test(command) && /(?:key|token|secret|password|credential)/i.test(command)) {
      return { blocked: true, reason: "Pi Cascade privacy policy blocks dumping credential-like environment values" };
    }
  }
  return { blocked: false };
}
