export function modelId(model) {
  return model?.id || model?.model || model?.modelId || "";
}

export function sameModel(left, right) {
  return Boolean(left && right && left.provider === right.provider && modelId(left) === modelId(right));
}

export function usesConfiguredModel(profile) {
  return profile?.selectionMode === "configured";
}

export function activeToolNames(pi) {
  const active = pi.getActiveTools?.();
  if (Array.isArray(active)) {
    return active.map((tool) => (typeof tool === "string" ? tool : tool?.name)).filter(Boolean);
  }
  return (pi.getAllTools?.() || []).map((tool) => tool.name).filter(Boolean);
}

export function createToolPolicyState() {
  return { restricted: false, snapshot: [] };
}

export function applyRoleToolPolicy({ pi, profile, controls = [], state }) {
  const available = new Set((pi.getAllTools?.() || []).map((tool) => tool.name));
  if (profile?.restrictTools === true) {
    if (!state.restricted) state.snapshot = activeToolNames(pi);
    const desired = [...new Set([...(profile.tools || []), ...controls])].filter((name) => available.has(name));
    pi.setActiveTools(desired);
    state.restricted = true;
    return { changed: true, restricted: true, tools: desired };
  }
  if (state.restricted) {
    const restored = [...new Set([...(state.snapshot || []), ...controls])].filter((name) => available.has(name));
    pi.setActiveTools(restored);
    state.restricted = false;
    state.snapshot = [];
    return { changed: true, restricted: false, tools: restored };
  }
  const active = activeToolNames(pi);
  const desired = [...new Set([...active, ...controls])].filter((name) => available.has(name));
  if (desired.length !== active.length || desired.some((name, index) => name !== active[index])) {
    pi.setActiveTools(desired);
    return { changed: true, restricted: false, tools: desired };
  }
  return { changed: false, restricted: false, tools: active };
}
