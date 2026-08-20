import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelRuntime,
  SessionManager,
  createAgentSession
} from "@earendil-works/pi-coding-agent";

const EMPTY_USAGE = Object.freeze({
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
});

class FixedAssistantStream {
  constructor(events, result) {
    this.events = events;
    this.finalResult = result;
  }

  async *[Symbol.asyncIterator]() {
    for (const event of this.events) yield event;
  }

  async result() {
    return this.finalResult;
  }
}

function message(model, content, stopReason) {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason,
    timestamp: Date.now()
  };
}

test("Cascade performs a real local model/tool loop without user API keys", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cascade-actual-agent-"));
  const agentDir = join(cwd, ".cascade-agent");
  const proofPath = join(cwd, "cascade-proof.txt");
  const model = {
    id: "cascade-local-smoke",
    name: "Cascade Local Smoke",
    api: "cascade-local-smoke-api",
    provider: "cascade-local-smoke",
    baseUrl: "local://cascade",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 4096
  };
  let modelCalls = 0;

  const streamResponse = () => {
    modelCalls += 1;
    if (modelCalls === 1) {
      const toolCall = {
        type: "toolCall",
        id: "cascade-write-proof",
        name: "write",
        arguments: {
          path: proofPath,
          content: "written by the real Cascade agent loop\n"
        }
      };
      const initial = message(model, [], "pending");
      const final = message(model, [toolCall], "toolUse");
      return new FixedAssistantStream([
        { type: "start", partial: initial },
        { type: "toolcall_start", contentIndex: 0, partial: initial },
        { type: "toolcall_end", contentIndex: 0, toolCall, partial: final },
        { type: "done", reason: "toolUse", message: final }
      ], final);
    }

    const initial = message(model, [], "pending");
    const final = message(model, [{ type: "text", text: "done" }], "stop");
    return new FixedAssistantStream([
      { type: "start", partial: initial },
      { type: "text_start", contentIndex: 0, partial: initial },
      { type: "text_delta", contentIndex: 0, delta: "done", partial: final },
      { type: "text_end", contentIndex: 0, content: "done", partial: final },
      { type: "done", reason: "stop", message: final }
    ], final);
  };

  const provider = {
    id: model.provider,
    name: model.name,
    auth: {
      apiKey: {
        name: "Keyless local test provider",
        async check() {
          return { type: "api_key", source: "local-test" };
        },
        async resolve() {
          return { auth: {}, source: "local-test" };
        }
      }
    },
    getModels() {
      return [model];
    },
    stream() {
      return streamResponse();
    },
    streamSimple() {
      return streamResponse();
    }
  };

  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false
  });
  runtime.registerNativeProvider(provider);

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(),
    tools: ["read", "write", "edit", "bash"]
  });

  const events = [];
  const unsubscribe = session.subscribe((event) => events.push(event.type));
  try {
    await session.prompt("Use the write tool to create the proof file, then finish.");
    await session.waitForIdle();
  } finally {
    unsubscribe();
    session.dispose();
  }

  assert.equal(modelCalls, 2, "the engine should continue after the real tool result");
  assert.equal(existsSync(proofPath), true, "the real write tool should create the requested file");
  assert.equal(readFileSync(proofPath, "utf8"), "written by the real Cascade agent loop\n");
  assert.ok(events.includes("tool_execution_start"));
  assert.ok(events.includes("tool_execution_end"));
  assert.ok(events.includes("agent_settled"));
});
