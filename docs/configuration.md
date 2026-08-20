# Configuration reference

For normal use, configure Cascade inside the TUI:

```text
/login openrouter
/model
/cascade-setup
```

The TUI can persist settings for the current session, the current project, or all Cascade projects. JSON is the automation and advanced-provider interface, not a startup requirement.

Cascade keeps application state separate from Pi:

- `~/.cascade/agent/settings.json`: engine and global compaction settings
- `~/.cascade/agent/auth.json`: Cascade provider credentials
- `~/.config/cascade/config.json`: global orchestration settings
- `<repo>/.cascade/config.json`: trusted project orchestration settings

Configuration is merged in this order:

1. built-in safe defaults;
2. `~/.config/cascade/config.json`;
3. trusted project `.cascade/config.json`;
4. an explicit `--cascade-config` file;
5. environment and CLI overrides.

Objects merge recursively. Arrays replace earlier arrays.

## Complete shape

```json
{
  "schemaVersion": 1,
  "mode": "single",
  "piBinary": "auto",
  "worker": {},
  "expert": {},
  "providers": {},
  "routing": {},
  "budgets": {},
  "privacy": {},
  "evidence": {},
  "harnessLearning": {},
  "verification": {},
  "workspaceRuntime": {},
  "ui": {}
}
```


## Bundled Pi runtime

`piBinary` defaults to `"auto"`. In that mode Cascade resolves the pinned `@earendil-works/pi-coding-agent@0.84.2` dependency from its own installation and launches `dist/cli.js` with the current Node.js executable. A separately installed global `pi` command is not used or required.

Set `piBinary` or `CASCADE_PI_BIN` only for development, compatibility testing, or an intentionally external Pi build. The value may be an executable name on `PATH` or an absolute path.

Use these commands to inspect the resolved runtime:

```bash
cascade runtime
cascade self-test
```

## Worker and expert profiles

```json
{
  "selectionMode": "configured",
  "thinkingMode": "configured",
  "provider": "openrouter",
  "model": "vendor/model-id",
  "thinking": "high",
  "restrictTools": false,
  "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"],
  "instructions": "Profile-specific instructions",
  "timeoutMs": 600000,
  "maxOutputCharacters": 120000
}
```

`selectionMode: "native"` makes the worker follow the model selected in Cascade's `/model` interface. `selectionMode: "configured"` pins the profile to `provider` and `model`. `thinkingMode` behaves the same way for thinking level.

`restrictTools` defaults to `false`. In that mode Cascade inherits the engine's entire active tool set, including Cascade-only extension tools. The `tools` array becomes an allowlist only when `restrictTools` is explicitly true.

`timeoutMs` and `maxOutputCharacters` govern isolated expert episodes.

Valid thinking levels follow Pi: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Pi clamps unsupported levels to model capability.

Consultation, review, and investigation automatically remove `edit` and `write` from the expert tool list. An explicitly authorized takeover uses the expert's configured list.

## Custom providers

```json
{
  "providers": {
    "my-endpoint": {
      "name": "My Endpoint",
      "baseUrl": "https://example.invalid/v1",
      "apiKey": "$MY_ENDPOINT_KEY",
      "api": "openai-completions",
      "authHeader": true,
      "headers": {},
      "models": [
        {
          "id": "model-id",
          "name": "Model display name",
          "reasoning": true,
          "input": ["text"],
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          },
          "contextWindow": 131072,
          "maxTokens": 32768
        }
      ]
    }
  }
}
```

The supported adapter names follow Pi's provider contract, including `openai-responses`, `openai-completions`, `anthropic-messages`, and `google-generative-ai`.

The bundled `meta-model-api` profile is ordinary configuration and may be overridden. Run `cascade probe worker` after changing its adapter, model ID, base URL, or headers.

## Routing

```json
{
  "routing": {
    "enabled": true,
    "autoConsult": true,
    "allowModelInitiatedTakeover": false,
    "injectRecommendation": true,
    "cooldownTurns": 2,
    "largeDiffLines": 500,
    "manyFiles": 8,
    "weights": {
      "toolError": 1.5,
      "repeatedError": 3,
      "verifierFailure": 3.5,
      "largeDiff": 1,
      "manyFiles": 1,
      "explicitUncertainty": 3,
      "staleProgress": 2,
      "protectedPath": 6
    },
    "thresholds": {
      "recommend": 4,
      "consult": 7,
      "takeover": 11
    },
    "failureCommands": ["test", "pytest", "vitest", "cargo test", "go test"]
  }
}
```

The router scores the observed trajectory. It does not classify difficulty from the initial prompt alone. Automatic expert calls are disabled by default.

## Budgets

```json
{
  "budgets": {
    "maxExpertCalls": 4,
    "maxExpertCostUsd": 5,
    "maxSessionEstimatedCostUsd": 20,
    "maxEvidenceCharacters": 40000,
    "maxLedgerEntriesInHandoff": 80
  }
}
```

Provider-reported cost is preferred. The model catalog's per-million-token rates are used when the provider reports usage but not cost.

## Privacy

```json
{
  "privacy": {
    "classification": "unknown",
    "allowContributor": false,
    "contributorPattern": "contributor",
    "requireExplicitRepositoryConsent": true,
    "redactSecrets": true,
    "storeRawToolOutput": false,
    "allowImagesToContributor": false,
    "denyPaths": [".env", ".env.*", "**/*.pem", "**/credentials/**"],
    "blockDeniedBuiltInTools": true,
    "blockSuspiciousBash": true
  }
}
```

Valid classifications are `public`, `internal`, `confidential`, `regulated`, and `unknown`.

## Evidence

```json
{
  "evidence": {
    "enabled": true,
    "persist": true,
    "includeGitState": true,
    "includeRecentToolFailures": true,
    "includeHarnessManifest": true
  }
}
```

Persistent orchestration evidence lives under `~/.local/state/cascade/sessions/` unless `CASCADE_STATE_DIR` is set. Engine sessions live separately under `~/.cascade/agent/sessions/`.

## Verification

```json
{
  "verification": {
    "discoverFromRepository": true,
    "commands": [],
    "timeoutMs": 600000,
    "requireBeforeCompletion": true,
    "autoRunBeforeCompletion": true,
    "maxCompletionGateRuns": 2
  }
}
```

A command may be a string or a structured command record accepted by the verifier module. Discovery inspects common package/build manifests and CI conventions.

## Harness learning

```json
{
  "harnessLearning": {
    "mode": "observe",
    "scope": "repository",
    "maxPromptEntries": 12,
    "maxMemoryEntries": 40,
    "maxPromptCharacters": 12000,
    "requireReplayForPromotion": true,
    "requireExpertReviewForGlobal": true,
    "autoApplySessionMemories": false,
    "retirementDays": 60,
    "promotion": {
      "minimumTaskCount": 5,
      "maximumQualityRegression": 0,
      "maximumCostIncrease": 0.05,
      "maximumLatencyIncrease": 0.1,
      "maximumExpertCallRateIncrease": 0.05,
      "maximumComplexityIncrease": 0.1
    }
  }
}
```

Modes are `off`, `observe`, `propose`, `canary`, and `auto-local`. Global executable behavior is never automatically promoted.

## Programmatic workspace

```json
{
  "workspaceRuntime": {
    "enabled": false,
    "pythonBinary": "python3",
    "sandboxCommand": [],
    "allowUnsandboxed": false,
    "timeoutMs": 120000,
    "maxCodeCharacters": 20000,
    "maxOutputCharacters": 40000,
    "maxStateCharacters": 200000,
    "statePath": ""
  }
}
```

A sandbox command is an argument array and may contain `{python}`, `{script}`, and `{cwd}` placeholders. See `programmatic-workspace.md`.

## Environment variables

| Variable | Meaning |
|---|---|
| `CASCADE_CONFIG` | Explicit configuration file |
| `CASCADE_CONFIG_GLOBAL` | Override global configuration path |
| `CASCADE_CONFIG_PROJECT` | Override project configuration path |
| `CASCADE_MODE` | `single` or `dual` |
| `CASCADE_PI_BIN` | Advanced override for the bundled Pi runtime executable |
| `CASCADE_WORKER` | Worker `provider/model` |
| `CASCADE_EXPERT` | Expert `provider/model` |
| `CASCADE_WORKER_THINKING` | Worker thinking level |
| `CASCADE_EXPERT_THINKING` | Expert thinking level |
| `CASCADE_WORKER_TOOLS` | Comma list or JSON array |
| `CASCADE_EXPERT_TOOLS` | Comma list or JSON array |
| `CASCADE_WORKER_INSTRUCTIONS` | Worker overlay |
| `CASCADE_EXPERT_INSTRUCTIONS` | Expert overlay |
| `CASCADE_EXPERT_TIMEOUT_MS` | Expert timeout |
| `CASCADE_EXPERT_MAX_OUTPUT_CHARACTERS` | Expert response bound |
| `CASCADE_MAX_EXPERT_CALLS` | Expert call ceiling |
| `CASCADE_MAX_EXPERT_COST_USD` | Expert cost ceiling |
| `CASCADE_MAX_SESSION_COST_USD` | Total estimated session cost ceiling |
| `CASCADE_ALLOW_CONTRIBUTOR` | Explicit Contributor consent |
| `CASCADE_CLASSIFICATION` | Repository classification |
| `CASCADE_AUTO_CONSULT` | Enable automatic consultations |
| `CASCADE_HARNESS_MODE` | Harness mode |
| `CASCADE_WORKSPACE` | Enable workspace runtime |
| `CASCADE_WORKSPACE_PYTHON` | Python executable |
| `CASCADE_WORKSPACE_SANDBOX_COMMAND` | Comma list or JSON array |
| `CASCADE_WORKSPACE_UNSANDBOXED` | Explicit unsandboxed acknowledgement |
| `CASCADE_WORKSPACE_STATE_PATH` | State file override |
| `CASCADE_STATE_DIR` | Root for Cascade runtime state |

Wrapper flags map to these variables for one process. The JSON file remains the authoritative way to configure every nested policy field.


## Global compaction

Global Cascade compaction settings are stored in `~/.cascade/agent/settings.json`:

```json
{
  "quietStartup": true,
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

Use `cascade compaction show`, `cascade compaction set`, or `/cascade-compaction` rather than editing the file directly.

## Updates

`cascade update` and `cascade pull` reinstall the configured Git/npm source into the current global npm prefix. Override the source with `--source` or `CASCADE_UPDATE_SOURCE` when testing a controlled branch or release.
