import { basename } from "node:path";
import cascadeCore from "./index.mjs";
import { PACKAGE_VERSION } from "./core/defaults.mjs";

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function visibleLength(value) {
  return String(value).replace(ANSI_PATTERN, "").length;
}

function truncateAnsi(value, width) {
  const text = String(value);
  if (visibleLength(text) <= width) return text;
  let result = "";
  let visible = 0;
  for (let index = 0; index < text.length && visible < Math.max(0, width - 1);) {
    if (text[index] === "\x1b") {
      const match = text.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
      if (match) {
        result += match[0];
        index += match[0].length;
        continue;
      }
    }
    result += text[index];
    visible += 1;
    index += 1;
  }
  return `${result}…\x1b[0m`;
}

function modelLabel(ctx) {
  const provider = ctx.model?.provider;
  const id = ctx.model?.id || ctx.model?.model || ctx.model?.modelId;
  if (!provider || !id || provider === "unknown" || id === "unknown") return "no model · /login · /model";
  return `${provider}/${id}`;
}

export function parseCascadeRuntimeStatus(value) {
  const text = String(value || "").trim();
  const attentionPrefix = "Cascade · attention: ";
  if (text.startsWith(attentionPrefix)) return { attention: text.slice(attentionPrefix.length) };
  const parts = text.split(" · ").map((part) => part.trim()).filter(Boolean);
  const role = parts[0] === "expert" ? "expert" : "worker";
  const mode = parts[1] === "dual" ? "dual" : "single";
  const routePart = parts.find((part) => part.startsWith("route "));
  const route = routePart ? routePart.slice("route ".length).split(":")[0] : "worker";
  return { role, mode, route };
}

function expertState(route) {
  if (route === "worker") return "on-demand";
  if (route === "recommend") return "recommended";
  if (route === "consult" || route === "expert") return "consult ready";
  return route || "on-demand";
}

export function formatCascadeModeStatus(status, ctx) {
  const parsed = parseCascadeRuntimeStatus(status);
  if (parsed.attention) return `Attention: ${parsed.attention}`;
  const activeModel = modelLabel(ctx);
  if (parsed.mode === "single") return `Single · Worker: ${activeModel}`;
  if (parsed.role === "expert") return `Dual · Active Expert: ${activeModel} · Worker paused`;
  return `Dual · Active Worker: ${activeModel} · Expert: ${expertState(parsed.route)}`;
}

export default function cascadeApplication(pi) {
  cascadeCore(pi);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setTitle(`Cascade · ${ctx.cwd}`);
    ctx.ui.setHeader((_tui, theme) => ({
      render(width) {
        const name = theme.fg("accent", theme.bold("Cascade"));
        const version = theme.fg("dim", `v${PACKAGE_VERSION}`);
        const line1 = `${name} ${version}`;
        const line2 = theme.fg("muted", `${modelLabel(ctx)} · /model · /cascade-setup`);
        return [truncateAnsi(line1, width), truncateAnsi(line2, width), ""];
      },
      invalidate() {}
    }));

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsubscribe,
        invalidate() {
          tui.requestRender();
        },
        render(width) {
          const branch = footerData.getGitBranch();
          const context = ctx.getContextUsage?.();
          const contextText = context?.percent == null
            ? "context ?"
            : `${context.percent.toFixed(1)}%/${Math.round(context.contextWindow / 1000)}k`;
          const status = footerData.getExtensionStatuses().get("cascade") || "worker · single · route worker";
          const project = `${basename(ctx.cwd)}${branch ? ` (${branch})` : ""}`;
          const modeStatus = formatCascadeModeStatus(status, ctx);
          const line = [
            theme.fg("accent", theme.bold("Cascade")),
            theme.fg("muted", modeStatus),
            theme.fg("dim", contextText),
            theme.fg("dim", project)
          ].join(theme.fg("dim", " · "));
          return [truncateAnsi(line, width)];
        }
      };
    });
  });
}
