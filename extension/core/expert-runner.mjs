import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTextContent, normalizeUsage, estimateUsageCost } from "./ledger.mjs";
import { redactSecrets } from "./privacy.mjs";
import { truncateText } from "./util.mjs";
import { providerCostFor } from "./providers.mjs";
import { spawnPi } from "./pi-runtime.mjs";

export function composeExpertPrompt({ mode, question, evidenceJson, instructions = "" }) {
  const access = mode === "consult"
    ? "You are a read-only expert consultant. Do not edit files."
    : mode === "review"
      ? "You are a read-only verifier. Try to falsify the current diagnosis or patch. Do not edit files."
      : mode === "takeover"
        ? "You are the temporary workspace-owning expert. You may edit files using only the configured tools. Make the smallest justified change, run relevant verification, and report exactly what you changed."
        : "Investigate independently using read-only repository tools. Do not edit files.";
  return `# Cascade expert episode\n\n${access}\n\nThe worker has already investigated the task. Use the evidence packet instead of restarting blindly. Inspect repository files only when the packet leaves a material uncertainty.\n\n## Question\n${question}\n\n## Evidence packet\n\n\`\`\`json\n${evidenceJson}\n\`\`\`\n\n## Output contract\n\nReturn one JSON object and no surrounding prose:\n\n{\n  "decision": "continue-worker | redirect-worker | investigate-more | takeover | block",\n  "summary": "concise diagnosis",\n  "findings": [\n    {"claim": "...", "evidence": "file, test, command, or packet fact", "confidence": 0.0}\n  ],\n  "patchConstraints": ["..."],\n  "requiredEvidence": ["..."],\n  "nextAction": "one concrete next action",\n  "risks": ["..."],\n  "confidence": 0.0\n}\n\nDo not claim verification without naming the evidence. Prefer one decisive next action over a miniature project-management department.\n${instructions ? `\n## Additional instructions\n${instructions}\n` : ""}`;
}

function buildArgs({ config, modelConfig, mode, promptPath, projectTrusted, extensionPath }) {
  const tools = mode === "consult" || mode === "review"
    ? modelConfig.tools.filter((tool) => !["edit", "write"].includes(tool))
    : modelConfig.tools;
  const args = [
    "--mode", "json",
    "--no-session",
    "--provider", modelConfig.provider,
    "--model", modelConfig.model,
    "--thinking", modelConfig.thinking,
    "--tools", tools.join(","),
    "--no-extensions"
  ];
  if (extensionPath) args.push("--extension", extensionPath);
  args.push(projectTrusted ? "--approve" : "--no-approve");
  args.push(`@${promptPath}`, "Answer the expert episode using the exact JSON contract in the attached file.");
  return args;
}

export async function runExpertEpisode({
  config,
  cwd,
  mode = "consult",
  question,
  evidenceJson,
  signal,
  projectTrusted = false,
  extensionPath = "",
  onEvent = () => {}
}) {
  if (config.mode !== "dual") throw new Error("Expert episodes require dual mode");
  if (!config.expert?.provider || !config.expert?.model) throw new Error("Expert model is not configured");
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "cascade-expert-"));
  const promptPath = join(temporaryDirectory, "episode.md");
  const configPath = join(temporaryDirectory, "cascade.json");
  const prompt = composeExpertPrompt({
    mode,
    question: config.privacy.redactSecrets ? redactSecrets(question) : question,
    evidenceJson: config.privacy.redactSecrets ? redactSecrets(evidenceJson) : evidenceJson,
    instructions: config.expert.instructions
  });
  writeFileSync(promptPath, prompt, { encoding: "utf8", mode: 0o600 });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
`, { encoding: "utf8", mode: 0o600 });

  const args = buildArgs({
    config,
    modelConfig: config.expert,
    mode,
    promptPath,
    projectTrusted,
    extensionPath
  });
  const startedAt = Date.now();
  let stderr = "";
  let stdoutRemainder = "";
  let finalMessage;
  let latestUsage = {};
  const events = [];

  try {
    const result = await new Promise((resolvePromise, reject) => {
      const { child } = spawnPi(config, args, {
        cwd,
        env: {
          ...process.env,
          CASCADE_CHILD: "1",
          CASCADE_CONFIG: configPath,
          CASCADE_PROJECT_TRUSTED: projectTrusted ? "1" : "0",
          AI_AGENT: "cascade-expert"
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1500).unref();
      }, Number(config.expert.timeoutMs || 600000));

      const abort = () => {
        child.kill("SIGTERM");
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Expert episode aborted"));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });

      const handleStdoutLine = (rawLine) => {
        const line = rawLine.trim();
        if (!line) return;
        try {
          const event = JSON.parse(line);
          events.push(event);
          onEvent(event);
          if (event.usage) latestUsage = event.usage;
          if (event.type === "message_end" && event.message?.role === "assistant") {
            finalMessage = event.message;
            if (event.message.usage) latestUsage = event.message.usage;
          }
          if (event.type === "agent_end" && Array.isArray(event.messages)) {
            const assistant = [...event.messages].reverse().find((message) => message?.role === "assistant");
            if (assistant) finalMessage = assistant;
          }
        } catch {
          onEvent({ type: "unparsed_stdout", line });
        }
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutRemainder += chunk;
        for (;;) {
          const newline = stdoutRemainder.indexOf("\n");
          if (newline < 0) break;
          handleStdoutLine(stdoutRemainder.slice(0, newline));
          stdoutRemainder = stdoutRemainder.slice(newline + 1);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = truncateText(`${stderr}${chunk}`, 40000);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code, childSignal) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        handleStdoutLine(stdoutRemainder);
        stdoutRemainder = "";
        if (timedOut) return reject(new Error(`Expert episode timed out after ${config.expert.timeoutMs} ms`));
        if (code !== 0) {
          return reject(new Error(`Expert pi process exited with code ${code}${childSignal ? ` (${childSignal})` : ""}: ${stderr || "no stderr"}`));
        }
        resolvePromise({ code });
      });
    });

    void result;
    const text = truncateText(extractTextContent(finalMessage?.content ?? finalMessage), config.expert.maxOutputCharacters);
    if (!text) throw new Error(`Expert process completed without an assistant message${stderr ? `: ${stderr}` : ""}`);
    const parsed = parseExpertJson(text);
    const usage = normalizeUsage(finalMessage?.usage || latestUsage);
    const estimatedCostUsd = estimateUsageCost(usage, providerCostFor(config, config.expert));
    return {
      ok: true,
      mode,
      model: `${config.expert.provider}/${config.expert.model}`,
      text,
      parsed,
      usage,
      estimatedCostUsd,
      durationMs: Date.now() - startedAt,
      eventCount: events.length,
      stderr: truncateText(stderr, 4000)
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function parseExpertJson(text) {
  const source = String(text).trim();
  const candidates = [source];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(source.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {}
  }
  return {
    decision: "redirect-worker",
    summary: truncateText(source, 4000),
    findings: [],
    patchConstraints: [],
    requiredEvidence: [],
    nextAction: "Review the raw expert response",
    risks: ["Expert response did not satisfy the JSON contract"],
    confidence: 0
  };
}
