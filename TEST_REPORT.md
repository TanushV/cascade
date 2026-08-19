# Cascade 0.3.0 Test Report

Prepared on 2026-08-19.

## Local validation results

| Check | Result |
|---|---:|
| Automated tests | **65 passed, 0 failed** |
| Static syntax/import checks | **54 JavaScript modules passed** |
| Branding checks | Passed |
| Legal and attribution checks | Passed |
| Package smoke tests | Passed |
| Clean local npm install | Passed |
| Clean-prefix global npm install | Passed |
| Git-source installation simulation | Passed |
| Automatic Pi runtime dependency resolution | Passed |
| Installed CLI `--version` | Passed |
| Installed CLI `self-test` | Passed |
| Native Pi startup with no provider keys | Passed |
| Real pseudo-terminal TUI interaction | Passed |
| Offline end-to-end TUI model/tool/edit loop | Passed |
| Legacy disabled-Contributor startup regression | Passed |
| Global compaction persistence and CLI | Passed |
| One-command updater invocation | Passed |
| Real temporary Git verification | Passed |

## Real TUI validation

The suite launches `bin/cascade.mjs` under an actual Unix pseudo-terminal against the real pinned Pi runtime. It removes all provider API-key environment variables and creates the same old `.cascade/config.json` shape that previously produced:

```text
Worker endpoint blocked: privacy.allowContributor is false
```

The test confirms that:

- the native Pi TUI renders;
- Cascade starts rather than rejecting the profile;
- Pi's `read`, `bash`, `edit`, and `write` tools remain active;
- Pi's real built-in `write` tool executes and creates a proof file from the running TUI;
- Cascade and native Pi slash commands are registered;
- `/cascade-setup` opens and cancels normally;
- `/cascade-compaction` opens the global token-limit editor;
- `/cascade-update` opens the self-update confirmation without performing an update;
- Pi's `/model` interface opens;
- Pi's `/login` authentication selector opens;
- the process exits cleanly through Pi's normal keybinding.

No user key and no external model endpoint is used. A second PTY scenario serves a deterministic OpenAI-compatible model on localhost, runs a complete agent turn, executes Pi's real `write` tool, feeds the tool result back to the model, and verifies the final response and file contents.

## Covered behavior

- safe startup with no config, legacy config, invalid optional config, unavailable models, and blocked configured endpoints;
- native versus fixed worker selection;
- role-aware model and thinking changes;
- additive Pi tool parity and reversible explicit restriction;
- TUI worker/expert/provider/tool/budget/privacy setup;
- project/global/session configuration persistence without literal credentials;
- native Pi authentication handoff;
- exact expert subprocess arguments and bounded evidence handoffs;
- read-only consultation versus authorized takeover;
- routing, cooldown, budgets, evidence persistence, and session recovery;
- Contributor consent, redaction, image denial, and protected paths;
- repository verification and completion gating;
- harness proposal, replay, canary, promotion, and rollback;
- global Pi compaction settings;
- GitHub self-update command construction/execution;
- package, global-prefix, and Git-source installations;
- Windows npm and executable-shim behavior.

## Validation boundary

The automated suite deliberately does not use provider credentials. Live OpenRouter, Meta, or other provider inference depends on the user's account and must be validated with:

```bash
cascade probe worker --approve
cascade probe expert --approve
```
