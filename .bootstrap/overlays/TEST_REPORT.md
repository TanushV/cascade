# Pi Cascade 0.1.3 Test Report

Prepared on 2026-08-18.

## Local validation results

| Check | Result |
|---|---:|
| Automated tests | **45 passed, 0 failed** |
| Static syntax/import checks | **42 JavaScript modules passed** |
| Legal and attribution checks | **Passed** |
| Package smoke tests | **Passed** |
| Clean local npm install | Passed |
| Clean-prefix global npm install | Passed |
| Git-source installation simulation | Passed |
| Automatic Pi runtime dependency installation | Passed using an isolated local registry |
| Installed CLI `--version` | Passed |
| Installed CLI `self-test` | Passed |
| Packaged Pi runtime resolution | Passed |
| No separately installed global `pi` command required | Passed |
| Real temporary Git worktree verification | Passed |
| Protocol-faithful expert subprocess | Passed |
| Source-tree overlay application | Passed |
| Cross-platform JavaScript entrypoint launch | Passed |
| Pi license attribution and version consistency | Passed |

## Covered behavior

The automated suite covers:

- standalone runtime resolution and external-runtime override;
- exact Node.js minimum-version comparison;
- cross-platform JavaScript entrypoint launch through Node;
- single-model and dual-model configuration;
- independent worker and expert provider, model, thinking, tools, instructions, timeout, output, and cost overrides;
- exact expert subprocess arguments and fail-closed execution;
- read-only consultation versus explicit workspace takeover;
- compact evidence handoffs and malformed-response fallback;
- OpenRouter and custom OpenAI-compatible provider registration;
- Contributor consent, repository classification, denied paths, image blocking, and secret redaction;
- append-only evidence persistence and long-session budget restoration;
- adaptive routing, threshold-gated consultation, verifier-failure escalation, cooldown, and session budgets;
- verifier discovery and execution against a real changed Git worktree;
- completion gating after repository mutation and rejection of false verifier lookalikes;
- scoped harness proposals, replay, canary activation, promotion, and rollback;
- optional programmatic workspace persistence, sandbox refusal, and timeout handling;
- provider capability-probe event processing;
- clean application into a temporary Pi-style source checkout.

## GitHub publication validation

The repository includes:

- Linux, macOS, and Windows CI;
- Node.js 22.19 and Node.js 24 coverage;
- exact-commit installation directly from GitHub;
- CodeQL analysis;
- Dependabot for npm and GitHub Actions;
- tag-driven release artifact generation and GitHub Release publishing.

The GitHub-source bootstrap reconstructs an exact locally tested archive and verifies SHA-256 `2ea552b01521022c9972b93ad6b2c889b91dbe4f9c64589e0051eb38a57e4c95` before materialization. Small fixes discovered by cross-platform CI are stored as ordinary, reviewable files in `.bootstrap/overlays/` and applied deterministically after the verified base tree.

## Validation boundaries

The build environment could not access the public npm or GitHub networks directly. The npm installation test therefore used a protocol-faithful local package fixture with the exact official Pi package name, version, exports, and executable layout. It validates package dependency installation, executable resolution, argument propagation, and process invocation, but it does not claim to have downloaded the public Pi tarball in that environment.

Live Meta Model API and OpenRouter calls were not executed because the environment had neither user credentials nor outbound provider access. `pi-cascade doctor`, `pi-cascade probe worker`, and `pi-cascade probe expert` validate real authentication, streaming, tool execution, and exact selected models on the user's machine.
