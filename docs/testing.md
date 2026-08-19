# Testing

## Automated local suite

Run:

```bash
npm test
npm run check
npm run smoke
```

The suite covers:

- configuration precedence and project trust;
- full worker/expert profile overrides;
- one-model collapse;
- provider registration and exact model selection;
- isolated expert JSON-stream parsing;
- read-only consultation and editable takeover tool policies;
- append-only evidence persistence and session recovery;
- route escalation, decay, cooldown, and budget admission;
- Contributor consent, secret redaction, image denial, and protected paths;
- real temporary Git repositories and completion verification;
- harness proposals, canaries, replay metrics, promotion, rollback, and non-persistence of canaries;
- optional workspace sandbox refusal and bounded state persistence;
- package overlay installation;
- npm package creation, local installation, and isolated global installation with no pre-existing `pi` executable.

A protocol-faithful local npm registry supplies a package with the exact official Pi package name, version, exports, and CLI layout during offline release smoke tests. The final Cascade tarball is installed by itself, proving npm resolves the runtime as its dependency rather than relying on a pre-existing global `pi` command. Protocol-faithful fake Pi executables are also used for focused child-process tests. Repository verification tests use actual Git and actual subprocess commands.

## What local tests do not prove

The build environment has no provider credentials and no direct network access. Therefore the local suite does not claim that a particular OpenRouter route or Meta catalog entry is currently enabled for your account.

Run the live probes after configuring credentials:

```bash
pi-cascade doctor --approve
pi-cascade probe worker --approve
pi-cascade probe expert --approve
```

A probe verifies authentication, exact model selection, streaming completion, tool execution, usage reporting, and Pi's provider adapter path. It consumes a small amount of provider quota.

## Evaluation manifests

`pi-cascade eval` executes each task in Pi JSON mode and then runs deterministic checks.

```bash
pi-cascade eval examples/eval-manifest.json --output eval-report.json
```

Harness replay executes the same manifest under baseline and canary harness states. Isolation is enabled by default. `--no-isolation` is available for controlled disposable workspaces and may contaminate state between runs.

## Release evidence

`TEST_REPORT.md` records the exact commands, runtime, counts, and limitations for the distributed archive.
