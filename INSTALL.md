# Installation

Pi Cascade requires Node.js 22.19.0 or newer. A separate global Pi installation is not required; npm installs the pinned Pi runtime dependency automatically.

## Install from GitHub

Install the latest `main` branch:

```bash
npm install -g github:TanushV/cascade --ignore-scripts
```

For reproducible use, install the tagged release:

```bash
npm install -g github:TanushV/cascade#v0.1.3 --ignore-scripts
```

Verify the installation:

```bash
pi-cascade --version
pi-cascade self-test
pi-cascade runtime
```

## Install from a release tarball

Download `pi-cascade-0.1.3.tgz` from the GitHub release and run:

```bash
npm install -g /absolute/path/to/pi-cascade-0.1.3.tgz --ignore-scripts
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
