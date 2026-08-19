# Architecture

## Additive Pi integration

Cascade's primary invariant is:

```text
Cascade capability surface >= native Pi capability surface
```

The `cascade` executable launches the pinned Pi runtime with the Cascade extension and otherwise leaves Pi's startup model selection, authentication, TUI, commands, sessions, extensions, and active worker tools intact.

Cascade does **not** select a worker before the TUI opens. A fixed worker is activated after `session_start` only when the operator deliberately configured one. If that profile is unavailable or blocked, Cascade retains Pi's current model/tool surface and keeps `/login`, `/model`, and setup commands available.

## Three planes

```text
Immutable control plane
  privacy · credentials · hard budgets · protected paths · audit · rollback

Task execution plane
  native Pi worker · expert subprocess · evidence ledger · router · verification

Harness learning plane
  scoped candidates · replay metrics · canary · promotion · rollback · retirement
```

## Runtime delivery

Cascade declares `@earendil-works/pi-coding-agent@0.84.2` as a pinned runtime dependency and resolves it from its own installation. Parent sessions, expert subprocesses, probes, and diagnostics all use that runtime. A separately installed global `pi` command is not required.

## Worker ownership and tool parity

The parent Pi session owns repository edits. By default, Cascade snapshots and preserves Pi's active tool surface, including tools from other extensions. It changes the active set only when the operator explicitly enables a restrictive role allowlist.

```text
native Pi tools
      +
Cascade controls
      =
worker tool surface
```

A restricted role can be restored without losing the original Pi tools.

## Worker model behavior

The worker has two selection modes:

- `native`: Pi's current model and `/model` picker remain authoritative;
- `configured`: Cascade activates the exact configured provider/model after startup.

Native mode is the default. Model and thinking-level changes made through Pi's TUI are tracked role-aware rather than overwritten.

## Expert process

Expert episodes run as isolated Pi JSON-mode subprocesses with:

- exact provider and model;
- exact thinking level;
- a configurable tool list;
- a compact evidence packet;
- timeout and output bounds;
- the same project-trust decision.

Consultation and review remove editing tools. A takeover is explicitly authorized and may edit only through the configured expert tool list. Only one process owns workspace edits at a time.

## Startup safety

Configuration, endpoint policy, or missing credentials may block **inference**, but must not block the operator from reaching the TUI.

The wrapper therefore injects only the extension. Configuration validation, legacy migration, model activation, and privacy checks happen after Pi has initialized. Invalid optional configuration falls back to native Pi with a warning.

## Evidence and routing

The append-only ledger records goals, tool outcomes, route signals, Git state, checkpoints, verification, usage, expert episodes, and harness changes. Expert handoffs are bounded and redacted.

The router scores trajectory evidence such as repeated failures, verifier failures, uncertainty, stale progress, large diffs, and protected-path attempts. Expert admission additionally checks cooldown and cost/call budgets.

## Completion and compaction

Repository changes invalidate previous completion proof. Cascade discovers and runs repository verification before settlement when configured.

Cascade augments Pi's compaction summary with structured continuation state. Global token limits are stored in Pi's own `~/.pi/agent/settings.json`, so they apply to both Cascade and ordinary Pi sessions.

## Updates

`cascade update` resolves to the GitHub source and performs the global package update behind one stable command. `/cascade-update` performs the same operation through Pi's TUI and requires a restart to load the new code.

## Single mode

Single mode is native Pi plus Cascade evidence/verification features. It denies expert admission but does not create a reduced alternative runtime.
