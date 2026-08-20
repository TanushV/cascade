export const PACKAGE_VERSION = "0.4.1";
export const CONFIG_SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  mode: "single",
  piBinary: "auto",
  worker: {
    selectionMode: "native",
    thinkingMode: "native",
    restrictTools: false,
    provider: "openrouter",
    model: "openrouter/auto",
    thinking: "medium",
    tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    instructions: ""
  },
  expert: {
    selectionMode: "configured",
    thinkingMode: "configured",
    restrictTools: false,
    provider: "openrouter",
    model: "openrouter/auto",
    thinking: "high",
    tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    timeoutMs: 600000,
    maxOutputCharacters: 120000,
    instructions: ""
  },
  providers: {
    "meta-model-api": {
      name: "Meta Model API",
      baseUrl: "https://api.meta.ai/v1",
      apiKey: "$MODEL_API_KEY",
      api: "openai-completions",
      authHeader: true,
      headers: {},
      models: [
        {
          id: "muse-spark-1.2-contributor",
          name: "Muse Spark 1.2 Contributor",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 0.10, output: 0.20, cacheRead: 0.002, cacheWrite: 0 },
          contextWindow: 1048576,
          maxTokens: 131072
        },
        {
          id: "muse-spark-1.2",
          name: "Muse Spark 1.2 Standard",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
          contextWindow: 1048576,
          maxTokens: 131072
        }
      ]
    }
  },
  routing: {
    enabled: true,
    autoConsult: false,
    allowModelInitiatedTakeover: false,
    injectRecommendation: true,
    cooldownTurns: 2,
    largeDiffLines: 500,
    manyFiles: 8,
    weights: {
      toolError: 1.5,
      repeatedError: 3.0,
      verifierFailure: 3.5,
      largeDiff: 1.0,
      manyFiles: 1.0,
      explicitUncertainty: 3.0,
      staleProgress: 2.0,
      protectedPath: 6.0
    },
    thresholds: {
      recommend: 4.0,
      consult: 7.0,
      takeover: 11.0
    }
  },
  privacy: {
    classification: "unknown",
    allowContributor: false,
    allowImagesToContributor: false,
    redactSecrets: true,
    contributorPattern: "contributor",
    deniedPaths: [
      ".env",
      ".env.*",
      "**/.env",
      "**/.env.*",
      "**/credentials*",
      "**/secrets*",
      "**/*secret*",
      "**/*token*",
      "**/*.pem",
      "**/*.key",
      "**/.aws/**",
      "**/.ssh/**",
      "**/.git/**"
    ]
  },
  budgets: {
    maxExpertCalls: 4,
    maxExpertCostUsd: 2.0,
    maxSessionEstimatedCostUsd: 5.0,
    maxEvidenceCharacters: 28000,
    maxLedgerEntriesInHandoff: 80
  },
  verification: {
    requireBeforeCompletion: true,
    autoRunBeforeCompletion: true,
    maxCompletionGateRuns: 1,
    timeoutMs: 600000,
    commands: []
  },
  evidence: {
    includeGitState: true,
    maxLedgerEntries: 500
  },
  harnessLearning: {
    mode: "observe",
    scope: "repository",
    autoApplySessionMemories: false,
    replayMinimumCases: 1
  },
  workspaceRuntime: {
    enabled: false,
    pythonPath: "python3",
    sandboxCommand: [],
    allowUnsandboxed: false,
    statePath: ".cascade/workspace/state.json",
    timeoutMs: 30000,
    maxStateCharacters: 200000
  },
  ui: {
    showStatus: true
  }
});

export const VALID_MODES = new Set(["single", "dual"]);
export const VALID_SELECTION_MODES = new Set(["native", "configured"]);
export const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const VALID_CLASSIFICATIONS = new Set(["unknown", "public", "internal", "confidential", "regulated"]);
export const VALID_HARNESS_MODES = new Set(["off", "observe", "propose", "canary", "auto-local"]);
