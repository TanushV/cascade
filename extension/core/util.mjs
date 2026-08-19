import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return deepClone(override);
  }
  const result = deepClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

export function readJsonFile(path, { optional = false } = {}) {
  if (!existsSync(path)) {
    if (optional) return undefined;
    throw new Error(`File not found: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function atomicWriteJson(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  renameSync(temporary, path);
}

export function atomicWriteText(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, { encoding: "utf8", mode });
  renameSync(temporary, path);
}

export function removeIfExists(path) {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function shortHash(value, length = 12) {
  return sha256(value).slice(0, length);
}

export function safeFileName(value, fallback = "item") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))];
}

export function modelReference(model) {
  if (!model || typeof model !== "object") return "";
  const provider = typeof model.provider === "string" ? model.provider.trim() : "";
  const id = typeof model.model === "string" ? model.model.trim() : "";
  if (!provider) return id;
  if (!id) return provider;
  return `${provider}/${id}`;
}

export function parseModelReference(reference, fallbackProvider = "") {
  if (typeof reference !== "string" || !reference.trim()) return undefined;
  const trimmed = reference.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { provider: fallbackProvider, model: trimmed };
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}

export function resolvePathFrom(base, path) {
  if (!path) return "";
  return resolve(base, path);
}

export function truncateText(value, maximum, suffix = "\n...[truncated]") {
  const text = String(value ?? "");
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - suffix.length))}${suffix}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
