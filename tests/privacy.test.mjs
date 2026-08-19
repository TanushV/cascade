import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../extension/core/defaults.mjs";
import { evaluateContributorPolicy, globToRegExp, inspectToolCallForPrivacy, redactSecrets } from "../extension/core/privacy.mjs";
import { deepClone } from "../extension/core/util.mjs";

test("contributor models require public explicit consent", () => {
  const config = deepClone(DEFAULT_CONFIG);
  assert.equal(evaluateContributorPolicy(config, config.worker).allowed, false);
  config.privacy.allowContributor = true;
  config.privacy.classification = "public";
  assert.equal(evaluateContributorPolicy(config, config.worker).allowed, true);
  config.privacy.classification = "confidential";
  assert.equal(evaluateContributorPolicy(config, config.worker).allowed, false);
});

test("private models are not blocked by contributor policy", () => {
  const config = deepClone(DEFAULT_CONFIG);
  const result = evaluateContributorPolicy(config, { provider: "openrouter", model: "anthropic/private" });
  assert.equal(result.allowed, true);
  assert.equal(result.contributor, false);
});

test("denied paths and credential dumps are blocked", () => {
  const config = deepClone(DEFAULT_CONFIG);
  const cwd = "/tmp/project";
  assert.equal(inspectToolCallForPrivacy({ toolName: "read", input: { path: ".env" }, cwd, config }).blocked, true);
  assert.equal(inspectToolCallForPrivacy({ toolName: "read", input: { path: "src/index.ts" }, cwd, config }).blocked, false);
  assert.equal(inspectToolCallForPrivacy({ toolName: "bash", input: { command: "printenv API_KEY" }, cwd, config }).blocked, true);
});

test("secret redaction preserves labels and removes values", () => {
  const redacted = redactSecrets("api_key=supersecretvalue token: abcdefghijklmnopqrstuvwxyz Bearer abcdefghijklmnop");
  assert.match(redacted, /api_key=\[REDACTED\]/i);
  assert.doesNotMatch(redacted, /supersecretvalue/);
  assert.match(redacted, /Bearer \[REDACTED_TOKEN\]/);
});

test("glob conversion supports recursive patterns", () => {
  const pattern = globToRegExp("**/credentials/**");
  assert.equal(pattern.test("src/credentials/token.json"), true);
  assert.equal(pattern.test("src/config/token.json"), false);
});
