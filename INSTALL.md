# Installation and update

## Requirements

- Node.js 22.19.0 or newer
- npm
- Git
- Internet access for installation and provider use

## First installation

```bash
npm install -g github:TanushV/cascade --ignore-scripts
```

Do not install Pi separately. Cascade installs its pinned engine dependency inside its own package.

Verify:

```bash
cascade --version
cascade self-test
cascade paths
```

## Start

```bash
cd /path/to/repository
cascade
```

No `cascade init` is required. Use `--approve` only when you want trusted project-local `.cascade` configuration or extensions:

```bash
cascade --approve
```

Authenticate and configure inside the TUI:

```text
/login openrouter
/model
/cascade-setup
```

Credentials are stored under `~/.cascade/agent/auth.json`. Pi's `~/.pi` data is not imported.

## Update

After the first installation:

```bash
cascade update
```

Equivalent alias:

```bash
cascade pull
```

Preview the update command:

```bash
cascade update --dry-run
```

## Global compaction settings

```bash
cascade compaction show
cascade compaction set --reserve-tokens 16384 --keep-recent-tokens 20000
```

The settings apply to all Cascade projects and are stored in `~/.cascade/agent/settings.json`.

## Remove an old installation

Only use this when replacing an older broken package or changing Node installations:

```bash
npm uninstall -g cascade
npm install -g github:TanushV/cascade --ignore-scripts
```

Cascade project configuration and credentials are not deleted by npm uninstall.

## Uninstall completely

```bash
npm uninstall -g cascade
rm -rf ~/.cascade
rm -rf ~/.config/cascade
```

The final two commands permanently remove Cascade credentials, settings, sessions, extensions, and global orchestration configuration.
