import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { atomicWriteJson, deepMerge, readJsonFile } from "./util.mjs";

const EXTENSION_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

export function getCascadeHome(env = process.env) {
  if (env.CASCADE_HOME) return resolve(expandHome(env.CASCADE_HOME));
  const home = env.HOME ? resolve(env.HOME) : homedir();
  return join(home, ".cascade");
}

export function getCascadeAgentDir(env = process.env) {
  if (env.CASCADE_AGENT_DIR) return resolve(expandHome(env.CASCADE_AGENT_DIR));
  return join(getCascadeHome(env), "agent");
}

export function getCascadeSettingsPath(env = process.env) {
  return join(getCascadeAgentDir(env), "settings.json");
}

export function getCascadeAuthPath(env = process.env) {
  return join(getCascadeAgentDir(env), "auth.json");
}

export function getCascadeSessionDir(env = process.env) {
  return env.CASCADE_SESSION_DIR
    ? resolve(expandHome(env.CASCADE_SESSION_DIR))
    : join(getCascadeAgentDir(env), "sessions");
}

export function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return homedir();
  if (text.startsWith("~/")) return join(homedir(), text.slice(2));
  return text;
}

export function ensureCascadeAgentLayout(env = process.env) {
  const agentDir = getCascadeAgentDir(env);
  for (const relative of ["extensions", "skills", "prompts", "themes", "sessions"]) {
    mkdirSync(join(agentDir, relative), { recursive: true });
  }
  ensureCascadeAgentSettings(env);
  return agentDir;
}

export function ensureCascadeAgentSettings(env = process.env) {
  const path = getCascadeSettingsPath(env);
  const defaults = {
    quietStartup: true,
    compaction: {
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000
    }
  };
  const existed = existsSync(path);
  let current = {};
  try {
    current = readJsonFile(path, { optional: true }) || {};
  } catch {
    // Do not destroy a malformed file during startup. The engine will surface it.
    return { path, settings: undefined, created: false, malformed: true };
  }
  const merged = deepMerge(defaults, current);
  const changed = JSON.stringify(merged) !== JSON.stringify(current);
  if (changed) atomicWriteJson(path, merged, 0o600);
  return { path, settings: merged, created: changed && !existed };
}

function enumerateExtensions(directory) {
  if (!existsSync(directory)) return [];
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && EXTENSION_EXTENSIONS.has(extname(entry.name))) {
      results.push(path);
      continue;
    }
    if (entry.isDirectory()) {
      for (const candidate of ["index.ts", "index.mts", "index.js", "index.mjs", "index.cjs"]) {
        const indexPath = join(path, candidate);
        if (existsSync(indexPath) && statSync(indexPath).isFile()) {
          results.push(indexPath);
          break;
        }
      }
    }
  }
  return results.sort();
}

export function discoverCascadeResources({ cwd = process.cwd(), projectTrusted = false, env = process.env } = {}) {
  const agentDir = getCascadeAgentDir(env);
  const projectRoot = resolve(cwd);
  const global = {
    extensions: enumerateExtensions(join(agentDir, "extensions")),
    skills: existingDirectories([join(agentDir, "skills")]),
    prompts: existingDirectories([join(agentDir, "prompts")]),
    themes: existingDirectories([join(agentDir, "themes")])
  };
  const project = projectTrusted
    ? {
        extensions: enumerateExtensions(join(projectRoot, ".cascade", "extensions")),
        skills: existingDirectories([join(projectRoot, ".cascade", "skills")]),
        prompts: existingDirectories([join(projectRoot, ".cascade", "prompts")]),
        themes: existingDirectories([join(projectRoot, ".cascade", "themes")])
      }
    : { extensions: [], skills: [], prompts: [], themes: [] };
  return {
    extensions: [...global.extensions, ...project.extensions],
    skills: [...global.skills, ...project.skills],
    prompts: [...global.prompts, ...project.prompts],
    themes: [...global.themes, ...project.themes]
  };
}

function existingDirectories(paths) {
  return paths.filter((path) => existsSync(path) && statSync(path).isDirectory());
}
