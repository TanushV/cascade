export function modelId(model) {
  return model?.id || model?.model || model?.modelId || "";
}

export function sameModel(left, right) {
  return Boolean(
    left &&
    right &&
    left.provider === right.provider &&
    modelId(left) === modelId(right)
  );
}

export function usesConfiguredModel(profile) {
  return profile?.selectionMode === "configured";
}

export function activeToolNames(pi) {
  const active = pi.getActiveTools?.();
  if (Array.isArray(active)) {
    return active
      .map((tool) => (typeof tool === "string" ? tool : tool?.name))
      .filter(Boolean);
  }
  return (pi.getAllTools?.() || []).map((tool) => tool.name).filter(Boolean);
}

export function createToolPolicyState() {
  return {
    restricted: false,
    snapshot: [],
    nativeBaseline: []
  };
}

export function captureNativeToolBaseline(pi, state) {
  const current = activeToolNames(pi);
  if (!state.nativeBaseline.length) state.nativeBaseline = [...current];
  else state.nativeBaseline = [...new Set([...state.nativeBaseline, ...current])];
  return [...state.nativeBaseline];
}

function availableToolNames(pi) {
  return new Set((pi.getAllTools?.() || []).map((tool) => tool.name).filter(Boolean));
}

function setIfChanged(pi, current, desired) {
  if (current.length === desired.length && current.every((value, index) => value === desired[index])) {
    return false;
  }
  pi.setActiveTools(desired);
  return true;
}

/**
 * Apply a role tool policy without subtracting native Pi capabilities unless the
 * operator explicitly requested a restrictive allowlist.
 */
export function applyRoleToolPolicy({ pi, profile, controls = [], state }) {
  const available = availableToolNames(pi);
  const current = activeToolNames(pi);
  captureNativeToolBaseline(pi, state);

  if (profile?.restrictTools === true) {
    if (!state.restricted) state.snapshot = [...current];
    const desired = [...new Set([...(profile.tools || []), ...controls])]
      .filter((name) => available.has(name));
    const changed = setIfChanged(pi, current, desired);
    state.restricted = true;
    return { changed, restricted: true, tools: desired };
  }

  if (state.restricted) {
    const desired = [...new Set([
      ...(state.snapshot || []),
      ...(state.nativeBaseline || []),
      ...controls
    ])].filter((name) => available.has(name));
    const changed = setIfChanged(pi, current, desired);
    state.restricted = false;
    state.snapshot = [];
    return { changed, restricted: false, tools: desired };
  }

  // Registered Cascade controls should be additive. Pi's active tools, including
  // tools supplied by other extensions, remain intact.
  const desired = [...new Set([...current, ...controls])]
    .filter((name) => available.has(name));
  const changed = setIfChanged(pi, current, desired);
  return { changed, restricted: false, tools: desired };
}

export function snapshotPiSurface(pi) {
  return {
    tools: activeToolNames(pi),
    commands: (pi.getCommands?.() || []).map((command) => command.name || command.invocationName).filter(Boolean)
  };
}

export function comparePiSurface(before, after) {
  const afterTools = new Set(after.tools || []);
  const afterCommands = new Set(after.commands || []);
  return {
    missingTools: (before.tools || []).filter((name) => !afterTools.has(name)),
    missingCommands: (before.commands || []).filter((name) => !afterCommands.has(name))
  };
}
