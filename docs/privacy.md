# Privacy and trust

## Contributor endpoints

Cascade treats a model identifier matching `privacy.contributorPattern` as a distinct data-use class. The endpoint is blocked unless the repository is classified `public` and `privacy.allowContributor` is explicitly true.

No fallback may cross from a private endpoint to Contributor unless that endpoint is independently configured and admitted by the same policy.

## Denied paths and tool calls

While a Contributor model is active, Cascade inspects built-in `read`, `edit`, `write`, `grep`, `find`, `ls`, and suspicious `bash` calls against `privacy.denyPaths`. Common credential locations are denied by default. Images are blocked unless explicitly enabled.

The policy applies both to the parent worker and to isolated expert episodes.

## Evidence redaction

Evidence handoffs redact common key, token, authorization, password, and secret forms. Stored tool output is bounded, and full raw output is disabled by default.

Redaction is defense in depth. Arbitrary source text may still contain identifying or proprietary information that does not resemble a credential.

## Trust boundary

Pi extensions and generated commands execute with the user's operating-system permissions. Cascade's privacy policy controls admission and selected built-in tools; it does not create kernel-level filesystem, process, network, or credential isolation.

Use an external container, micro-VM, or policy sandbox for untrusted repositories or generated code. The optional programmatic workspace has its own explicit sandbox requirement, but the rest of Pi must also be isolated when stronger boundaries are needed.

## Project trust

Project `.cascade/config.json`, project extensions, and project skills should be loaded only after Pi trusts the project. The wrapper recognizes `--approve` and passes it through to Pi. Non-interactive automation should set project trust deliberately rather than relying on an interactive prompt.
