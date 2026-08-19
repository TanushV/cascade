# Configuration reference

Configuration is merged in this order:

1. built-in defaults;
2. `~/.config/cascade/config.json`;
3. trusted project `.cascade/config.json`;
4. an explicit `--cascade-config` file;
5. environment and wrapper overrides.

Objects merge recursively. Arrays replace earlier arrays.

## Complete shape

```json
{
  "schemaVersion": 1,
  "mode": "dual",
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

Ordinary users can configure both roles through `/cascade-setup`, `/cascade-worker`, and `/cascade-expert`. The JSON representation is:

```json
{
  "selectionMode": "native",
  "thinkingMode": "native",
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

`selectionMode` is:

- `native`: preserve Pi's current model and native `/model` picker;
- `configured`: activate the exact `provider` and `model` after the TUI starts.

`thinkingMode` is `native` or `configured`. `restrictTools: false` preserves Pi's active tools. When `restrictTools` is `true`, the role uses the explicit `tools` allowlist plus required Cascade controls.

The worker defaults to native selection and unrestricted tools. The expert defaults to configured selection. `timeoutMs` and `maxOutputCharacters` govern isolated expert episodes.

Valid thinking levels follow Pi: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Pi clamps unsupported levels to model capability.

Consultation and review remove `edit` and `write` even when present in the expert list. An explicitly authorized takeover uses the configured expert list.

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

The router scores the observed trajectory. It does not classify difficulty from the initial prompt alone. Automatic expert consultation is enabled by default but remains subject to trajectory thresholds, cooldown, and budgets.

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

Persistent evidence lives under `~/.local/state/cascade/sessions/` unless `CASCADE_STATE_DIR` is set.

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

## TUI configuration

```text
/cascade-setup
/cascade-worker
/cascade-expert
/cascade-auth
/cascade-tools
```

The setup wizard can save to the current session, `.cascade/config.json`, or `~/.config/cascade/config.json`. Pi's native `/login` and `/model` commands remain available.

## Global Pi compaction limits

These settings live in Pi's global settings file, not the Cascade config:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 24000,
    "keepRecentTokens": 32000
  }
}
```

Edit them through `/cascade-compaction` or:

```bash
cascade compaction show
cascade compaction set --enabled true --reserve-tokens 24000 --keep-recent-tokens 32000
```

## Updates

```bash
cascade update
cascade update --dry-run
```

The default update source is `github:TanushV/cascade`; `CASCADE_UPDATE_SPEC` can override it for development or forks. The TUI equivalent is `/cascade-update`.

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
| `CASCADE_UPDATE_SPEC` | Override the GitHub/npm source used by `cascade update` |
| `PI_CODING_AGENT_DIR` | Override Pi's global agent/settings/auth directory |

Wrapper flags map to these variables for one process. The JSON file remains the authoritative way to configure every nested policy field.
