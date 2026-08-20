# Testing

## Full local suite

```bash
npm ci --ignore-scripts
npm run ci
```

The suite covers:

- configuration precedence, migration, and project trust;
- isolated `~/.cascade` state, auth, sessions, settings, and resource discovery;
- proof that fake `~/.pi` context and extensions are neither displayed nor executed;
- a real pseudo-terminal Cascade launch with custom header/footer and native commands;
- a real no-key agent loop using the engine's built-in `write` tool and a second post-tool model turn;
- native worker model selection and unrestricted tool inheritance;
- configured worker/expert overrides and reversible explicit tool restrictions;
- expert consultation, read-only investigation, and explicit takeover;
- evidence, routing, budgets, privacy, verification, persistence, and harness replay;
- global compaction settings and self-update planning;
- npm tarball, global-prefix, and Git-source installations without a separate Pi install.

## Real terminal isolation test

The pseudo-terminal test creates two fake application homes:

```text
~/.pi/agent/extensions/pi-only-sentinel.mjs
~/.cascade/agent/extensions/cascade-only-sentinel.mjs
```

It launches the actual `cascade` terminal process and proves that only the Cascade extension executes. It also verifies the Cascade brand, absence of Pi's startup header, absence of Pi global context, and a responsive `/cascade` command.

## Real no-key agent/tool test

A keyless local provider drives the actual `createAgentSession` engine. The first model turn requests the real built-in `write` tool. The engine writes a file, returns the tool result, performs a second model turn, and settles. This test does not use network access or user credentials.

## Live providers

The automated suite deliberately does not use user API keys. Provider-account validation remains explicit:

```bash
cascade probe worker --approve
cascade probe expert --approve
```

A probe may consume a small amount of provider quota.

## Cross-platform CI

GitHub Actions runs the suite on Linux, macOS, Windows, Node 22.19, and Node 24. It also installs the exact Git commit into a clean prefix and runs `cascade --version`, `cascade self-test`, `cascade paths`, and update/compaction smoke checks. CodeQL runs separately.
