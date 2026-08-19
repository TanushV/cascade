# Programmatic workspace

The optional `cascade_workspace` tool provides a small persistent Python computation surface for structured intermediate work. It is disabled by default.

## Contract

The submitted Python receives:

```python
input   # JSON-compatible input supplied by the tool call
state   # JSON-compatible state restored from the previous call
result  # assign a JSON-compatible return value here
```

A successful call persists `state` and returns `result`.

The Python wrapper exposes a deliberately narrow built-in set plus `json`, `math`, `statistics`, `re`, `collections`, `itertools`, and `functools`. This reduces accidental reach but is not a security boundary.

## Sandbox requirement

Pi Cascade refuses to enable the runtime unless either:

- `workspaceRuntime.sandboxCommand` is configured; or
- `workspaceRuntime.allowUnsandboxed` is explicitly true.

A sandbox command is an argument array:

```json
{
  "workspaceRuntime": {
    "enabled": true,
    "sandboxCommand": [
      "my-sandbox",
      "--workspace", "{cwd}",
      "--",
      "{python}", "-I", "-u", "{script}"
    ]
  }
}
```

Placeholders:

- `{python}`: configured Python executable;
- `{script}`: generated temporary wrapper script;
- `{cwd}`: repository working directory.

The configured command is trusted code. Pi Cascade does not inspect whether it genuinely isolates filesystem, process, network, or credentials.

## Persistence

Default state location:

```text
~/.pi/agent/cascade/workspaces/<repository-hash>/<session-id>.json
```

Set `workspaceRuntime.statePath` for a repository-relative override or `PI_CASCADE_STATE_DIR` for an alternate runtime-state root.

## Limits

The runtime enforces:

- code length;
- process timeout;
- output length;
- serialized state length;
- JSON-compatible input, result, and state.

It runs one ordinary Python process per call. It is not a full IPython kernel and does not launch recursive agents.
