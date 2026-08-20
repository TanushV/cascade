# Changelog

## 0.4.1 - 2026-08-19

### Changed

- Worker and expert model selection now reuse Pi's native searchable model selector instead of Cascade maintaining a competing provider/model list.
- The persistent footer now describes dual-mode ownership in plain language: active worker or expert, worker pause state, and whether the expert is on-demand, recommended, or ready for consultation.
- Detailed routing scores, costs, and evidence remain available through `/cascade` instead of occupying the persistent status bar.

### Fixed

- Restored fuzzy model search, catalog refresh, keyboard behavior, and provider availability indicators when choosing Cascade role models.
- Removed the ambiguous `worker · dual · route ... · expert ...` telemetry from the visible footer.

## 0.4.0 - 2026-08-19

### Changed

- Cascade now has an isolated application home under `~/.cascade/agent` and no longer imports Pi settings, credentials, sessions, global context, or extensions.
- Replaced the Pi startup identity with Cascade-owned header, footer, terminal title, resource discovery, and state paths while retaining the Pi engine internally.
- The default worker uses native Cascade `/model` selection, starts in single mode, inherits all active tools, and does not require configuration to open.
- Project initialization is optional rather than a startup prerequisite.

### Added

- `/cascade-setup`, `/cascade-worker`, `/cascade-expert`, `/cascade-auth`, and `/cascade-compaction` TUI flows.
- `cascade update` / `cascade pull` for in-place updates.
- Global compaction controls via `cascade compaction show|set`.
- `cascade paths` for inspecting isolated application locations.
- Real pseudo-terminal isolation tests and a real no-key agent/tool execution test.

### Fixed

- Old or blocked Contributor profiles no longer prevent Cascade from starting.
- Pi-only extensions and global context can no longer leak into Cascade.
- Cascade no longer forces a model, provider, thinking level, or tool allowlist before the TUI starts.
- Removed obsolete source-overlay and fork-bootstrap tooling from the distributed application.


## 0.2.0 - 2026-08-18

### Changed

- Renamed the project, npm package, executable, environment namespace, configuration paths, state paths, documentation, and release artifacts to **Cascade**.
- The command and package are now named `cascade`.

### Fixed

- Made npm subprocess invocation portable on Windows by running npm through its JavaScript entry point when available.
- Removed the completed source-bootstrap and temporary Windows-debug workflows.
- CI now installs from the lockfile with `npm ci` and validates the materialized source tree directly.

## 0.1.3 - 2026-08-18

### Added

- Cross-platform CI on Linux, macOS, and Windows, exact-commit GitHub installation validation, CodeQL, Dependabot, and tag-driven GitHub Release automation.
- Direct installation from `github:TanushV/cascade` and a dedicated `INSTALL.md`.
- Explicit Pi MIT attribution, a preserved upstream license copy, non-affiliation language, legal consistency checks, and security/contribution policies.
- Offline smoke coverage for both npm-tarball and Git-source installations.
- Version-manifest consistency and removed-integration source audits.

### Changed

- Generated project configuration now starts with repository classification `unknown` and Contributor access disabled. Enabling Contributor traffic requires an explicit repository-level decision.

### Fixed

- Long sessions now restore expert-call and cost totals from the complete persisted ledger even when more than 500 entries exist.
- Successful arbitrary shell commands containing words such as `test` or `build` no longer satisfy the completion-verification gate. Only discovered or explicitly configured verifier commands count as proof.
- The optional external cognition-suite integration remains fully removed from runtime, configuration, documentation, packaging, and notices.

## 0.1.1 - 2026-08-18

Standalone installation repair.

### Fixed

- Cascade now pins `@earendil-works/pi-coding-agent@0.84.2` as a runtime dependency.
- The parent worker, expert subprocess, provider probe, and doctor resolve the runtime from Cascade's own installation instead of requiring a global `pi` command.
- `piBinary` now defaults to `auto`; `--pi-bin` remains an advanced override.
- Added `cascade --version`, `cascade runtime`, and `cascade self-test`.
- Added clean local and isolated global install tests where only the Cascade tarball is installed.
- Corrected installation guidance so the tarball path is resolved from its actual download directory.

## 0.1.0 - 2026-08-18

Initial end-to-end Cascade implementation.

### Added

- Configurable single-model and two-model execution through one runtime path.
- Independently configurable worker and expert provider, model, reasoning level, tools, instructions, timeout, and expert output budget.
- OpenRouter support through Pi's built-in provider and OAuth/API-key handling.
- Meta Model API provider profile with Muse Spark 1.2 Standard and Contributor entries.
- Isolated expert consultations, investigations, reviews, and explicitly authorized takeovers.
- Typed append-only evidence ledger, compact handoffs, trajectory-conditioned routing, session resumption, and cost accounting.
- Contributor endpoint consent, repository classification, sensitive-path blocking, secret redaction, and image denial by default.
- Repository verification discovery, completion gates, and real Git worktree tracking.
- Versioned scoped harness state, inactive proposals, process-local canaries, replay evaluation, promotion, rollback, and retirement controls.
- Optional bounded programmatic Python workspace requiring an external sandbox or explicit unsandboxed acknowledgement.
- Pi wrapper CLI, model probes, doctor, evaluation runner, source-tree overlay, deterministic fork bootstrap, package smoke test, and local release builder.
