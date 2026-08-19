import { deepClone } from "./util.mjs";

const VALID_APIS = new Set([
  "openai-responses",
  "openai-completions",
  "anthropic-messages",
  "google-generative-ai"
]);

export function normalizeProviderModel(model) {
  if (!model || typeof model !== "object") throw new Error("Provider model must be an object");
  if (!model.id || !model.name) throw new Error("Provider model requires id and name");
  return {
    id: String(model.id),
    name: String(model.name),
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: Boolean(model.reasoning),
    input: Array.isArray(model.input) && model.input.length ? model.input : ["text"],
    cost: {
      input: Number(model.cost?.input ?? 0),
      output: Number(model.cost?.output ?? 0),
      cacheRead: Number(model.cost?.cacheRead ?? 0),
      cacheWrite: Number(model.cost?.cacheWrite ?? 0)
    },
    contextWindow: Number(model.contextWindow ?? 131072),
    maxTokens: Number(model.maxTokens ?? 16384),
    headers: model.headers,
    compat: model.compat,
    samplingParams: model.samplingParams,
    thinkingLevelMap: model.thinkingLevelMap
  };
}

export function validateProviderConfig(name, provider) {
  const errors = [];
  if (!name) errors.push("provider name is required");
  if (!provider || typeof provider !== "object") return [`provider ${name} must be an object`];
  if (!provider.baseUrl) errors.push(`provider ${name}.baseUrl is required`);
  if (!provider.api || !VALID_APIS.has(provider.api)) {
    errors.push(`provider ${name}.api must be one of ${[...VALID_APIS].join(", ")}`);
  }
  if (!provider.apiKey) errors.push(`provider ${name}.apiKey is required`);
  if (!Array.isArray(provider.models) || provider.models.length === 0) errors.push(`provider ${name}.models must not be empty`);
  for (const [index, model] of (provider.models || []).entries()) {
    if (!model.id) errors.push(`provider ${name}.models[${index}].id is required`);
    if (!model.name) errors.push(`provider ${name}.models[${index}].name is required`);
  }
  return errors;
}

export function registerConfiguredProviders(pi, config, { onWarning = () => {} } = {}) {
  const registered = [];
  for (const [name, rawProvider] of Object.entries(config.providers || {})) {
    const errors = validateProviderConfig(name, rawProvider);
    if (errors.length) {
      onWarning(errors.join("; "));
      continue;
    }
    const provider = deepClone(rawProvider);
    provider.models = provider.models.map(normalizeProviderModel);
    try {
      pi.registerProvider(name, provider);
      registered.push(name);
    } catch (error) {
      onWarning(`Could not register provider ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return registered;
}

export function findConfiguredModel(ctx, modelConfig) {
  if (!ctx?.modelRegistry || !modelConfig?.provider || !modelConfig?.model) return undefined;
  return ctx.modelRegistry.find(modelConfig.provider, modelConfig.model);
}

export function providerCostFor(config, modelConfig) {
  const provider = config.providers?.[modelConfig.provider];
  const model = provider?.models?.find((candidate) => candidate.id === modelConfig.model);
  return model?.cost;
}
