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
        const line2 = theme.fg("muted", `${modelLabel(ctx)} · /cascade-setup`);
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
          const status = footerData.getExtensionStatuses().get("cascade") || "ready";
          const project = `${basename(ctx.cwd)}${branch ? ` (${branch})` : ""}`;
          const line = [
            theme.fg("accent", theme.bold("Cascade")),
            theme.fg("dim", project),
            theme.fg("dim", contextText),
            theme.fg("muted", modelLabel(ctx)),
            theme.fg("dim", status)
          ].join(theme.fg("dim", " · "));
          return [truncateAnsi(line, width)];
        }
      };
    });
  });
}
