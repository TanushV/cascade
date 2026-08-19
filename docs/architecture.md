# Architecture

## Three planes

```text
Immutable control plane
  privacy · credentials · hard budgets · protected paths · audit · rollback

Task execution plane
  worker · expert subprocess · evidence ledger · adaptive router · verification

Harness learning plane
  scoped candidates · replay metrics · canary · promotion · rollback · retirement
```

## Standalone runtime delivery

Pi Cascade declares `@earendil-works/pi-coding-agent@0.84.2` as a normal runtime dependency and resolves its exported package location from inside the installed Cascade package. Parent sessions, expert subprocesses, probes, and diagnostics all launch that packaged runtime directly. A global `pi` command is neither discovered nor required unless the operator explicitly supplies `--pi-bin` as a development override.

## Thin Pi integration

Pi Cascade uses Pi's supported extension surface for provider registration, model switching, lifecycle events, custom tools, commands, persistent session entries, project trust, and package loading. Pi's base agent loop and terminal UI remain upstream-owned.

The wrapper performs the one operation an ordinary extension cannot perform before the first provider request: it selects the configured worker and injects the extension on process startup.

## Workspace ownership

The parent Pi session normally owns edits. Expert episodes are synchronous from the parent's perspective:

```text
parent pauses
  → checkpoint/evidence packet
  → isolated child Pi process
  → child exits
  → parent records outcome and resumes
```

Consultation, review, and investigation are forced read-only. An explicitly authorized takeover may edit with the expert's configured tools. This maintains one active workspace owner.

## Expert process

The child runs Pi's JSON event-stream mode with:

- exact provider and model;
- exact thinking level;
- bounded tool allowlist;
- compact evidence JSON;
- trust status;
- custom provider shim;
- timeout and output bounds.

Unavailable exact models fail closed. The runtime does not silently replace the expert with another provider/model.

## Evidence

The append-only ledger stores bounded, redacted records of:

- goals;
- tool calls and results;
- route signals;
- Git state;
- checkpoints;
- verifier results;
- model usage and estimated cost;
- expert episodes;
- harness changes.

The handoff compiler progressively compacts data while preserving valid JSON and the most decision-relevant facts.

## Routing

The router accumulates decaying trajectory signals rather than classifying the initial prompt. Signals include repeated errors, verifier failures, explicit uncertainty, stale progress, large diffs, broad file spread, and protected-path attempts.

Weights and thresholds are configuration. Model names and programming languages do not appear in routing branches. Expert admission also checks cooldown, call count, expert cost, and total session cost.

## Completion

When a repository diff changes, the previous completion proof becomes stale. Before settlement, the runtime may discover and run repository verification commands. Completion is blocked when required checks fail or remain unverified after the configured gate limit.

## Harness learning

Every trajectory records its harness manifest. Proposed prompt, memory, skill-description, or subagent-description edits remain inactive until evaluated. Process-local canaries cannot persist as promoted state by accident. Promotion writes versioned snapshots and supports rollback.

## Single mode

Single mode uses the same task plane and simply denies expert admission. There is no alternate legacy runtime.
