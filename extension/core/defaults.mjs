export const PACKAGE_VERSION = "0.1.3";
export const CONFIG_SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  mode: "dual",
  piBinary: "auto",
  worker: {
    provider: "meta-model-api",
    model: "muse-spark-1.2-contributor",
    thinking: "medium",
    tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    instructions: ""
  },
  expert: {
    provider: "openrouter",
    model: "openrouter/auto",
    thinking: "high",
    tools: ["read", "grep", "find", "ls", "bash"],
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
    autoConsult: true,
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
    },
    failureCommands: [
      "test",
      "pytest",
      "vitest",
      "jest",
      "cargo test",
      "go test",
      "npm run check",
      "npm test",
      "pnpm test",
      "bun test",
      "tsc",
      "typecheck",
      "lint",
      "build"
    ]
  },
  budgets: {
    maxExpertCalls: 4,
    maxExpertCostUsd: 5,
    maxSessionEstimatedCostUsd: 20,
    maxEvidenceCharacters: 40000,
    maxLedgerEntriesInHandoff: 80
  },
  privacy: {
    classification: "unknown",
    allowContributor: false,
    contributorPattern: "contributor",
    requireExplicitRepositoryConsent: true,
    redactSecrets: true,
    storeRawToolOutput: false,
    allowImagesToContributor: false,
    denyPaths: [
      ".env",
      ".env.*",
      "**/*.pem",
      "**/*.key",
      "**/credentials/**",
      "**/secrets/**",
      "**/.aws/**",
      "**/.ssh/**"
    ],
    blockDeniedBuiltInTools: true,
    blockSuspiciousBash: true
  },
  evidence: {
    enabled: true,
    persist: true,
    includeGitState: true,
    includeRecentToolFailures: true,
    includeHarnessManifest: true
  },
  harnessLearning: {
    mode: "observe",
    scope: "repository",
    maxPromptEntries: 12,
    maxMemoryEntries: 40,
    maxPromptCharacters: 12000,
    requireReplayForPromotion: true,
    requireExpertReviewForGlobal: true,
    autoApplySessionMemories: false,
    retirementDays: 60,
    promotion: {
      minimumTaskCount: 5,
      maximumQualityRegression: 0,
      maximumCostIncrease: 0.05,
      maximumLatencyIncrease: 0.10,
      maximumExpertCallRateIncrease: 0.05,
      maximumComplexityIncrease: 0.10
    }
  },
  verification: {
    discoverFromRepository: true,
    commands: [],
    timeoutMs: 600000,
    requireBeforeCompletion: true,
    autoRunBeforeCompletion: true,
    maxCompletionGateRuns: 2
  },
  workspaceRuntime: {
    enabled: false,
    pythonBinary: "python3",
    sandboxCommand: [],
    allowUnsandboxed: false,
    timeoutMs: 120000,
    maxCodeCharacters: 20000,
    maxOutputCharacters: 40000,
    maxStateCharacters: 200000,
    statePath: ""
  },
  ui: {
    showStatus: true,
    verboseNotifications: false
  }
});

export const CONTRIBUTOR_CLASSIFICATIONS_ALLOWED_BY_DEFAULT = new Set(["public"]);
export const VALID_MODES = new Set(["single", "dual"]);
export const VALID_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);
export const VALID_HARNESS_MODES = new Set(["off", "observe", "propose", "canary", "auto-local"]);
