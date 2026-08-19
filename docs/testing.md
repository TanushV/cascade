# Testing

## Full local suite

```bash
npm ci --ignore-scripts
npm run ci
```

The test suite covers:

- configuration precedence, project trust, legacy-config migration, and invalid-config fallback;
- native versus configured worker selection;
- preservation and reversible restriction of Pi's active tools;
- role-aware model/thinking changes;
- TUI setup and project/global/session persistence;
- native `/login` handoff and Pi model-registry selection;
- exact expert subprocess configuration, read-only consultation, and takeover;
- evidence persistence, routing, budgets, verification, and harness replay;
- Contributor consent, redaction, image denial, and protected paths;
- global Pi compaction settings and CLI editing;
- one-command self-update construction and execution;
- package creation, local/global installation, and Git-source installation;
- Windows command-shim handling;
- a real pseudo-terminal launch of the bundled Pi TUI.

## Real TUI smoke test

On Unix-like systems, `tests/tui-smoke.test.mjs` runs `scripts/tui-smoke.py` against the actual installed Pi runtime. It deliberately removes provider keys and creates the exact legacy `.cascade/config.json` that previously caused startup rejection.

The test verifies that:

1. Pi renders its native TUI;
2. Cascade does not reject startup;
3. native `read`, `bash`, `edit`, and `write` tools remain active;
4. `/cascade-setup` opens and cancels cleanly;
5. Pi's native `/model` interface opens;
6. Pi's native `/login` interface opens;
7. Cascade exits through Pi's normal keybinding.

No model endpoint or user key is used.

## Offline packaging smoke test

A protocol-faithful local npm registry supplies the exact Pi package name/version/layout during packaging tests. The final Cascade tarball is installed by itself into local, isolated-global, and Git-source prefixes. This proves Cascade resolves its own runtime dependency and does not depend on a pre-existing global `pi` command.

## Live provider probes

The automated suite intentionally does not use provider credentials. Run these with your own account after authentication:

```bash
cascade doctor --approve
cascade probe worker --approve
cascade probe expert --approve
```

A probe consumes provider quota and verifies authentication, exact model selection, streaming, tool execution, usage reporting, and the provider adapter path.

## Evaluation manifests

```bash
cascade eval examples/eval-manifest.json --output eval-report.json
```

Harness replay executes the same manifest under baseline and candidate harness states. Isolation is enabled by default.
