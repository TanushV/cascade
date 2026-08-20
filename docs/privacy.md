# Privacy and trust

## Application isolation

Cascade sets the engine directory to `~/.cascade/agent` and disables automatic Pi resource discovery. It does not read or execute:

- `~/.pi/agent/AGENTS.md`;
- `~/.pi/agent/auth.json`;
- `~/.pi/agent/extensions`;
- project `.pi/extensions`;
- Pi sessions or Pi settings.

Cascade discovers global extensions, skills, prompts, and themes only under `~/.cascade/agent`. Trusted project resources live under `.cascade`.

Repository `AGENTS.md` files remain available because they are project instructions, not Pi application state.

## Credentials

Native `/login` inside Cascade writes credentials to `~/.cascade/agent/auth.json`. Environment variables remain process-level inputs and are therefore shared if the user exports them in the shell. Secrets should not be written into project configuration.

## Contributor endpoints

A model identifier matching `privacy.contributorPattern` is treated as a distinct data-use class. It is blocked unless the repository is classified `public` and `privacy.allowContributor` is explicitly true.

A stale Contributor profile never blocks application startup. Policy is evaluated when Cascade actually selects or invokes that profile.

## Denied paths and tool calls

While a Contributor model is active, Cascade inspects built-in file/search tools and suspicious shell calls against `privacy.denyPaths`. Common credential locations are denied by default. Images are blocked unless explicitly enabled.

## Evidence redaction

Evidence handoffs redact common key, token, authorization, password, and secret forms. Stored tool output is bounded, and full raw output is disabled by default.

Redaction is defense in depth. Arbitrary source text may still contain identifying or proprietary information that does not resemble a credential.

## Operating-system boundary

Cascade and its extensions execute with the launching user's permissions. Use a container, micro-VM, or policy sandbox for untrusted repositories or generated commands.

## Project trust

Project `.cascade/config.json`, extensions, skills, prompts, and themes are loaded only when the project is trusted. `cascade --approve` intentionally enables those project-local resources.
