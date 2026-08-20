# Cascade 0.4.0 Test Report

## Scope

This release converts Cascade from a Pi wrapper with shared state into an isolated application built on the Pi engine. The validation focuses on startup, application identity, state separation, real tool use, packaging, updates, compaction, and the worker/expert orchestration layer.

## Local validation

Run with:

```bash
npm run ci
```

Validated behavior includes:

- Cascade-branded header, footer, and terminal title;
- no Pi startup header in the real terminal process;
- no loading or execution of `~/.pi` extensions;
- no loading of Pi global `AGENTS.md` context;
- positive loading of `~/.cascade/agent/extensions`;
- isolated auth, settings, sessions, extensions, skills, prompts, and themes;
- safe startup with no configuration and no API credentials;
- safe startup with an old blocked Contributor profile;
- native worker model selection and full active tool inheritance;
- explicit configured model selection and reversible tool restrictions;
- real built-in `write` tool execution through the actual agent loop;
- post-tool continuation and clean agent settlement;
- global compaction persistence;
- self-update command planning;
- single- and dual-model routing, expert consultation/takeover, evidence, privacy, verification, and session recovery;
- npm tarball, isolated global-prefix, and Git-source installation.

## Credential policy

No user API key is used by automated tests. Live provider validation is intentionally separate and account-specific.

## Cross-platform validation

GitHub Actions is expected to run:

- Ubuntu with Node 22.19;
- Ubuntu with Node 24;
- current macOS with Node 22.19;
- current Windows with Node 22.19;
- exact Git-source installation;
- CodeQL JavaScript analysis.

The final published commit and workflow conclusions should be treated as the release evidence, not an unmerged development branch.
