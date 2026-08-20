import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { truncateText } from "./util.mjs";
import { spawnPi } from "./pi-runtime.mjs";
import { getCascadeAgentDir, getCascadeSessionDir } from "./cascade-paths.mjs";

export async function probeModelProfile({ config, profile, cwd, extensionPath, probeExtensionPath, timeoutMs = 120000 }) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "cascade-probe-"));
  const configPath = join(temporaryDirectory, "cascade.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
`, { encoding: "utf8", mode: 0o600 });
  const args = [
    "--mode", "json",
    "--no-session",
    "--no-extensions",
    "--extension", extensionPath,
    "--extension", probeExtensionPath,
    "--provider", profile.provider,
    "--model", profile.model,
    "--thinking", profile.thinking || "low",
    "--tools", "cascade_probe_echo",
    "--no-approve",
    "Call cascade_probe_echo exactly once with value CASCADE_PROBE_OK. Then respond with the same value and nothing else."
  ];
  const startedAt = Date.now();
  const state = {
    providerResponse: false,
    toolStarted: false,
    toolCompleted: false,
    finalText: "",
    usage: {},
    events: 0
  };
  try {
    return await new Promise((resolvePromise) => {
    const { child } = spawnPi(config, args, {
      cwd,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: getCascadeAgentDir(),
        PI_CODING_AGENT_SESSION_DIR: getCascadeSessionDir(),
        CASCADE_CHILD: "1",
        CASCADE_CONFIG: configPath,
        AI_AGENT: "cascade-probe"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    let remainder = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);
    const handleStdoutLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      try {
        const event = JSON.parse(line);
        state.events += 1;
        if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") state.providerResponse = true;
        if (event.type === "tool_execution_start" && event.toolName === "cascade_probe_echo") state.toolStarted = true;
        if (event.type === "tool_execution_end" && event.toolName === "cascade_probe_echo" && !event.isError) state.toolCompleted = true;
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const content = event.message.content;
          state.finalText = typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.filter((item) => item?.type === "text").map((item) => item.text).join("\n")
              : "";
          state.usage = event.message.usage || event.usage || state.usage;
        }
      } catch {}
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = truncateText(`${stderr}${chunk}`, 30000); });
    child.stdout.on("data", (chunk) => {
      remainder += chunk;
      for (;;) {
        const newline = remainder.indexOf("\n");
        if (newline < 0) break;
        handleStdoutLine(remainder.slice(0, newline));
        remainder = remainder.slice(newline + 1);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, error: error.message, state, durationMs: Date.now() - startedAt });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      handleStdoutLine(remainder);
      remainder = "";
      const ok = code === 0 && !timedOut && state.providerResponse && state.toolStarted && state.toolCompleted && state.finalText.includes("CASCADE_PROBE_OK");
      resolvePromise({
        ok,
        code,
        signal,
        timedOut,
        profile: `${profile.provider}/${profile.model}`,
        state,
        stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
