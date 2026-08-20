# Architecture

## Application boundary

Cascade is a standalone application that uses the Pi coding-agent package as an internal engine dependency. The `cascade` launcher establishes a separate application boundary before starting the engine:

```text
Cascade CLI
  -> ~/.cascade/agent state and credentials
  -> Cascade-only resource discovery
  -> Cascade application TUI/header/footer
  -> Pi agent loop and built-in coding tools
  -> Cascade orchestration extension
```

The launcher disables automatic Pi extension, skill, prompt, and theme discovery, then explicitly loads Cascade's application extension plus resources from `~/.cascade/agent` and trusted project `.cascade` directories. It never discovers `~/.pi` or project `.pi/extensions`.

## Engine relationship

`@earendil-works/pi-coding-agent@0.84.2` supplies the model runtime, agent loop, terminal primitives, sessions, compaction, provider adapters, and built-in coding tools. Cascade does not fork or vendor Pi source. The dependency and compatible upstream commit are pinned and attributed.

## Execution planes

```text
Control plane
  isolated state · credentials · privacy · budgets · protected paths · update policy

Task plane
  worker · optional expert · evidence ledger · router · verification

Harness-learning plane
  scoped proposals · replay · canary · promotion · rollback
```

## Worker and expert

The parent session is the only default workspace owner. A native worker follows Cascade's `/model` selection and inherits all active tools. A configured worker may pin a model. Explicit `restrictTools: true` is required before Cascade narrows the worker tool set.

Expert consultation, review, and investigation run in a bounded child process with a compact evidence packet and read-only tools. An explicit takeover may edit with the expert profile's configured tools. Exact model selection fails closed; there is no silent capability or privacy downgrade.

## Evidence and routing

The append-only ledger stores bounded and redacted goals, repository facts, tool outcomes, route signals, checkpoints, verifier results, usage, and expert episodes. Routing uses the observed trajectory rather than guessing task difficulty from the initial prompt.

## Completion

Repository changes invalidate earlier verification. The completion gate discovers or uses configured checks, records the current diff identity, and requires successful evidence before completion when policy enables it.

## Compaction

Cascade uses the engine's structured compaction implementation but stores global limits in `~/.cascade/agent/settings.json`. The extension adds evidence and route state to compaction instructions so continuation state survives long sessions.

## Updating

`cascade update` runs npm against the configured Git source without uninstalling the current package first. Application data is outside the npm installation and survives updates.
