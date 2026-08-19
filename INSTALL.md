# Installation

Pi Cascade requires Node.js 22.19.0 or newer. A separate global Pi installation is not required; npm installs the pinned Pi runtime dependency automatically.

## Install from GitHub

```bash
npm install -g github:TanushV/cascade
```

The GitHub source contains a checksum-verified materializer for the exact tested source archive. npm runs it during installation, then installs `@earendil-works/pi-coding-agent@0.84.2` as a normal dependency. Do not use `--ignore-scripts` for this GitHub-source command while `.bootstrap/materialize.mjs` is present.

Verify:

```bash
pi-cascade --version
pi-cascade self-test
pi-cascade runtime
```

## Configure a repository

```bash
cd /path/to/repository
pi-cascade init
```

The generated configuration starts with `privacy.classification` set to `unknown` and `allowContributor` set to `false`. Explicitly classify the repository before enabling any endpoint whose terms permit training or retention.

Set provider credentials in your shell or secret manager, then validate the live endpoints:

```bash
export OPENROUTER_API_KEY="..."
export MODEL_API_KEY="..."
pi-cascade doctor --approve
pi-cascade probe worker --approve
pi-cascade probe expert --approve
```

## Uninstall

```bash
npm uninstall -g pi-cascade
```
