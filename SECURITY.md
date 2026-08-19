# Security policy

## Supported version

Security fixes are applied to the current `main` branch and the latest tagged release.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting feature for this repository when available. If that feature is unavailable, contact the repository owner privately through the contact method listed on the owner's GitHub profile. Do not include real API keys, customer source code, or proprietary provider transcripts in a report.

## Important trust boundary

Pi Cascade and Pi extensions execute with the permissions of the user who launches them. Model-generated shell commands and code are not automatically sandboxed. Use a container, virtual machine, or another external sandbox for untrusted repositories or generated code.

Contributor-endpoint filtering and secret redaction are defense-in-depth controls, not a confidentiality guarantee. Keep Contributor endpoints disabled for non-public repositories.

## Dependency security

Pi Cascade pins `@earendil-works/pi-coding-agent` to an exact version. Dependabot monitors npm and GitHub Actions dependencies. Runtime changes to the pinned Pi version must pass the full test and package-smoke suites and update `UPSTREAM.json` and third-party notices when necessary.
