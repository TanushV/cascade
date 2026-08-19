# Installing and updating Cascade

## Requirements

- Node.js `22.19.0` or newer
- npm
- GitHub access during installation/update

## First installation

```bash
npm install -g github:TanushV/cascade --ignore-scripts
```

Cascade installs its pinned Pi runtime dependency automatically. Do not install Pi separately unless you intentionally want an independent `pi` command.

Verify:

```bash
cascade --version
cascade self-test
cascade runtime
```

## Upgrading an older installation

Installing from the same GitHub source replaces the existing global Cascade package:

```bash
npm install -g github:TanushV/cascade --ignore-scripts
rehash
```

This one command is required when upgrading from 0.2.x, because those releases did not yet contain the updater.

After 0.3.0 is installed, use:

```bash
cascade update
# alias: cascade pull
```

Or inside the TUI:

```text
/cascade-update
```

Restart Cascade after updating.

## Start

```bash
cd /path/to/project
cascade
```

Use `cascade --approve` when the repository's project-local Pi/Cascade resources are trusted.

A config file is not required for startup. Configure interactively with:

```text
/login openrouter
/cascade-setup
```

## Existing 0.2 configuration

Cascade automatically migrates the old generated Contributor worker default so this combination:

```text
muse-spark-1.2-contributor
privacy.allowContributor = false
```

no longer prevents startup. Cascade opens Pi normally and lets you choose/authenticate a model in the TUI.

## Uninstall

```bash
npm uninstall -g cascade
```

Configuration and Pi credentials are stored separately and are not deleted automatically.
