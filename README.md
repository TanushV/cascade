# Pi Cascade

[![CI](https://github.com/TanushV/cascade/actions/workflows/ci.yml/badge.svg)](https://github.com/TanushV/cascade/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Independent project:** Pi Cascade is not affiliated with, sponsored by, or endorsed by the Pi project, Mario Zechner, or Earendil Works. “Pi” identifies compatibility with the upstream runtime.

Pi Cascade is a standalone command-line coding agent with a configurable one- or two-model orchestration layer. You install and run `pi-cascade`; a separate global `pi` installation is not required.

It provides:

- one active workspace-owning **worker**;
- one independently configured, on-demand **expert**;
- evidence-centered expert handoffs instead of full transcript replay;
- trajectory-conditioned escalation;
- deterministic verification and completion gates;
- endpoint privacy controls for Contributor traffic;
- a replay-gated, versioned harness-learning plane;
- an optional bounded programmatic workspace.

The implementation targets `@earendil-works/pi-coding-agent@0.84.2` at upstream commit `59a71b235dadb4ad0d67557a8abb0aaa093e68b4`. See [`UPSTREAM.json`](UPSTREAM.json).

## Install directly from GitHub

Requirements: Node.js `22.19.0` or newer, npm, and Internet access for the first installation.

```bash
npm install -g github:TanushV/cascade
```

The GitHub source currently contains a one-time, SHA-256-verified source materializer. npm reconstructs the exact tested source tree before packaging and installs the pinned Pi runtime dependency automatically. Do not add `--ignore-scripts` to this GitHub-source command while the materializer is present.

Verify:

```bash
pi-cascade --version
pi-cascade self-test
pi-cascade runtime
```

Expected shape:

```text
pi-cascade 0.1.3
bundled-pi 0.84.2

Pi Cascade self-test passed.
```

A separate `npm install -g @earendil-works/pi-coding-agent` is not needed.

## Start using it

```bash
cd /path/to/your/repository
pi-cascade init
```

The generated configuration starts privacy-safe: repository classification is `unknown`, and Contributor endpoints are disabled until explicitly enabled.

Set credentials for the providers you configure, for example:

```bash
export OPENROUTER_API_KEY="..."
export MODEL_API_KEY="..."
```

Validate the installation and live endpoints:

```bash
pi-cascade doctor --approve
pi-cascade probe worker --approve
pi-cascade probe expert --approve
```

Launch interactively:

```bash
pi-cascade --approve
```

Or provide a task directly:

```bash
pi-cascade --approve \
  "Inspect this repository, implement the smallest correct fix, and run the relevant checks."
```

## Model configuration

Both roles are fully configurable. Each can independently select:

- provider and model ID;
- reasoning level;
- tool allowlist;
- role instructions;
- timeout and output limits;
- provider base URL, API adapter, headers, and credential source;
- cost and escalation budgets.

Minimal dual-model example in `.pi/cascade.json`:

```json
{
  "schemaVersion": 1,
  "mode": "dual",
  "worker": {
    "provider": "meta-model-api",
    "model": "muse-spark-1.2-contributor",
    "thinking": "medium",
    "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"]
  },
  "expert": {
    "provider": "openrouter",
    "model": "openrouter/auto",
    "thinking": "high",
    "tools": ["read", "grep", "find", "ls", "bash"],
    "timeoutMs": 600000,
    "maxOutputCharacters": 120000
  },
  "privacy": {
    "classification": "public",
    "allowContributor": true
  }
}
```

Single-model mode uses the same evidence, verification, privacy, checkpoint, and harness path while disabling expert admission:

```bash
pi-cascade --single \
  --worker openrouter/vendor/model-id \
  "Repair the bug and run the repository checks"
```

## Runtime structure

```text
user task
   ↓
configured worker owns the repository workspace
   ↓
evidence ledger + tests + route signals
   ├─ continue worker
   ├─ consult/review with expert
   ├─ bounded read-only expert investigation
   └─ explicitly authorized expert takeover
   ↓
verification + checkpoint + completion gate
```

Only one process owns edits at a time. Expert episodes receive a compact, redacted evidence packet rather than the entire parent transcript.

## Useful commands

| Command | Purpose |
|---|---|
| `/cascade` | Show model profiles, budgets, routing state, privacy, and harness manifest |
| `/cascade-mode single\|dual` | Change mode for the current session |
| `/cascade-consult <question>` | Run a bounded read-only expert consultation |
| `/cascade-takeover [objective]` | Run one explicitly authorized expert editing episode |
| `/cascade-evidence [count]` | Show recent evidence records |
| `/cascade-verify` | Discover and execute repository checks |
| `/cascade-refine [focus]` | Generate one small evidence-backed harness proposal |
| `/cascade-privacy` | Display endpoint policy and denied paths |

## Privacy boundary

A model whose identifier matches the Contributor pattern is denied unless both:

1. `privacy.allowContributor` is `true`; and
2. `privacy.classification` is `public`.

Secret redaction and denied-path filtering are defense in depth, not a substitute for a real sandbox. Pi Cascade and Pi extensions normally execute with the permissions of the launching user.

## Development

```bash
git clone https://github.com/TanushV/cascade.git
cd cascade
npm install
npm run ci
```

The first `npm install` verifies and materializes the source archive when needed. Once the normal source tree is present, standard development commands apply.

## Validation

The verified base source archive plus its reviewable cross-platform overlays passed locally:

- **45 automated tests, 0 failures**;
- static syntax/import checks across **42 JavaScript modules**;
- legal and attribution consistency checks;
- standalone npm-tarball installation smoke tests;
- Git-source installation simulation;
- one- and two-model runtime, privacy, verification, persistence, replay, and takeover tests.

GitHub Actions adds Linux, macOS, Windows, Node 22.19, Node 24, exact-commit GitHub installation, CodeQL, Dependabot, and tag-driven release automation.

Live provider calls require your own credentials and are validated with `pi-cascade probe worker` and `pi-cascade probe expert`.

## Legal and upstream attribution

Pi Cascade is MIT-licensed. Pi remains a separately installed MIT-licensed dependency; its source tree is not incorporated into Pi Cascade's implementation. The repository preserves Pi's copyright and license notice and records the exact compatible package and commit.

See:

- [`LICENSE`](LICENSE)
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
- [`licenses/PI-LICENSE.txt`](licenses/PI-LICENSE.txt)
- [`UPSTREAM.json`](UPSTREAM.json)
- [`docs/legal.md`](docs/legal.md)

This is an engineering licensing review, not formal legal advice.
