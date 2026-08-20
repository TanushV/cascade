# Cascade

[![CI](https://github.com/TanushV/cascade/actions/workflows/ci.yml/badge.svg)](https://github.com/TanushV/cascade/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Cascade is a standalone terminal coding agent with an isolated application home, a native terminal UI, and optional one-worker/one-expert orchestration. It uses the MIT-licensed Pi coding-agent engine as a pinned runtime dependency, but it does not load your Pi configuration, sessions, context, or extensions.

Cascade is an independent project and is not affiliated with or endorsed by Pi, Mario Zechner, or Earendil Works.

## What is isolated

Cascade uses its own application directories:

```text
~/.cascade/agent/auth.json          provider credentials
~/.cascade/agent/settings.json      engine and compaction settings
~/.cascade/agent/sessions/          Cascade sessions
~/.cascade/agent/extensions/        Cascade-only extensions
~/.cascade/agent/skills/            Cascade-only skills
~/.config/cascade/config.json       global orchestration configuration
<repo>/.cascade/config.json         trusted project configuration
```

It deliberately does not auto-load `~/.pi`, `.pi/extensions`, Pi sessions, or Pi global context. Project `AGENTS.md` files remain available because they describe the repository rather than another application.

## Install

Requirements: Node.js 22.19.0 or newer, npm, Git, and Internet access for installation.

```bash
npm install -g github:TanushV/cascade --ignore-scripts
```

A separate Pi installation is not required. Verify the installed application:

```bash
cascade --version
cascade self-test
cascade paths
```

## Start

No initialization or model configuration is required merely to open Cascade:

```bash
cd /path/to/repository
cascade
```

Use `cascade --approve` when you intentionally trust project-local `.cascade` resources and configuration.

Inside the TUI:

```text
/login openrouter       authenticate using Cascade's isolated credential store
/model                   select the current worker model
/cascade-setup           configure single/dual mode, expert, budgets, and privacy
/cascade-worker          select native or fixed worker behavior
/cascade-expert          select the expert model
```

Provider environment variables also work, but `/login` avoids shell-history and repository-file mistakes.

## Default behavior

Cascade starts in single-model mode and uses the model selected in its own TUI. The worker inherits the full active tool set, including `read`, `write`, `edit`, `bash`, search tools, and Cascade-only extension tools. Cascade applies a tool allowlist only when `restrictTools` is explicitly enabled.

Dual mode adds one independently configured expert:

```text
user task
  -> worker owns the workspace
  -> evidence, tests, and route signals accumulate
  -> expert is consulted only when admitted or manually requested
  -> worker continues, or an explicit bounded takeover edits the workspace
  -> verification gate checks the final diff
```

Normal consultations are read-only. Only one model owns workspace edits at a time.

## TUI commands

| Command | Purpose |
|---|---|
| `/cascade` | Show current mode, role, models, routing, budgets, and privacy |
| `/cascade-setup` | Configure Cascade in the TUI and save session/project/global settings |
| `/cascade-worker` | Choose native TUI model selection or a fixed worker model |
| `/cascade-expert` | Choose the expert model |
| `/cascade-auth [provider]` | Prepare the isolated native `/login` flow |
| `/cascade-mode single\|dual` | Change orchestration mode for the current session |
| `/cascade-consult <question>` | Run a bounded expert consultation |
| `/cascade-takeover [objective]` | Explicitly authorize one bounded expert editing episode |
| `/cascade-evidence [count]` | Inspect recent evidence records |
| `/cascade-verify` | Discover and execute repository checks |
| `/cascade-compaction` | View or edit global Cascade compaction settings |

## Global compaction limits

Show the limits used across all Cascade projects:

```bash
cascade compaction show
```

Set them globally:

```bash
cascade compaction set \
  --enabled true \
  --reserve-tokens 16384 \
  --keep-recent-tokens 20000
```

These values are written to `~/.cascade/agent/settings.json`, not Pi's settings.

## Update without uninstalling

After the first installation:

```bash
cascade update
```

`cascade pull` is an alias. Inspect the command without changing anything:

```bash
cascade update --dry-run
```

The default update source is the repository's `main` branch. A controlled source can be supplied with `--source` or `CASCADE_UPDATE_SOURCE`.

## Provider and model configuration

The ordinary path is `/login`, `/model`, and `/cascade-setup`. JSON remains available for automation and advanced endpoints.

Example dual-mode project configuration:

```json
{
  "schemaVersion": 1,
  "mode": "dual",
  "worker": {
    "selectionMode": "native",
    "thinkingMode": "native",
    "restrictTools": false
  },
  "expert": {
    "selectionMode": "configured",
    "provider": "openrouter",
    "model": "vendor/frontier-model",
    "thinkingMode": "configured",
    "thinking": "high",
    "restrictTools": false
  },
  "routing": {
    "autoConsult": true
  },
  "privacy": {
    "classification": "confidential",
    "allowContributor": false
  }
}
```

Contributor endpoints are denied unless the repository is classified `public` and explicit consent is enabled. A stale optional Contributor profile never prevents Cascade from opening.

## Validation

The test suite includes:

- a real pseudo-terminal launch that proves Cascade branding and rejects Pi-only state and extensions;
- a real local agent loop that selects the built-in `write` tool, writes a file, consumes the tool result, and completes without API credentials;
- single- and dual-model routing, evidence, verification, privacy, persistence, and expert-process tests;
- npm tarball, global-prefix, and direct Git-source installation smoke tests;
- update-plan and global-compaction persistence tests;
- Linux, macOS, Windows, Node 22.19, Node 24, and CodeQL checks in GitHub Actions.

Live provider availability is account-specific. After authentication, validate selected configured profiles with:

```bash
cascade probe worker --approve
cascade probe expert --approve
```

## Development

```bash
git clone https://github.com/TanushV/cascade.git
cd cascade
npm ci --ignore-scripts
npm run ci
```

## Legal

Cascade is MIT-licensed. Pi remains a separate pinned MIT-licensed dependency. Its original license notice is preserved in [`licenses/PI-LICENSE.txt`](licenses/PI-LICENSE.txt), and integration details are recorded in [`UPSTREAM.json`](UPSTREAM.json) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
