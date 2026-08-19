# Harness learning

The evolving harness is a versioned artifact layer, not permission for a model to rewrite production controls.

## Scopes

From broadest to narrowest:

1. global;
2. ecosystem;
3. model pair;
4. repository;
5. session.

More specific active entries replace broader entries with the same kind, path, and title. Model-pair scope allows a handoff optimized for one worker/expert combination without contaminating unrelated pairings.

## Candidate lifecycle

```text
proposed → canary → evaluated → promoted → rolled-back or retired
```

A candidate declares:

- supporting evidence IDs;
- rationale;
- expected outcome;
- predicted regressions;
- scope;
- small create/update/delete edits.

A candidate does not modify the active global harness when created.

## Mutable entries

- `prompt`: supplemental behavioral guidance;
- `memory`: durable fact, decision, failure, or preference;
- `skill`: a description and interface contract, not automatically executed source code;
- `subagent`: a delegation description, not an automatically spawned process.

## Replay admission

Replay compares the same evaluation manifest under baseline and canary states. Admission considers:

- accepted task count and quality delta;
- deterministic checks;
- inference cost;
- latency;
- expert call rate;
- harness complexity growth;
- required expert review for broad scopes.

Promotion thresholds are configuration. The report and evaluation metrics are stored with the candidate.

## Canary behavior

Prompt and memory candidates may be activated for the current process. Canary IDs are deliberately process-local and are not serialized as promoted entries. Restarting the process clears them unless explicitly reactivated.

Executable behavior is never canaried by directly replacing production code in the running task process.

## Rollback and retirement

Promotion records before/after snapshots. Rollback restores the prior state. Entries may be retired when stale, unused, superseded, model-specific to an unavailable model, or harmful in replay.

## Immutable controls

The harness cannot edit:

- credentials;
- privacy classification or Contributor consent;
- hard cost ceilings;
- provider allowlists;
- sandbox rules;
- promotion and replay code;
- audit history;
- rollback;
- release predicates.
