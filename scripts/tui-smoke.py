#!/usr/bin/env python3
"""Exercise the real bundled Pi TUI without provider credentials."""
from __future__ import annotations

import json
import os
import pathlib
import pty
import re
import select
import shutil
import signal
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
ANSI_CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
ANSI_OSC = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)")


def clean(data: bytes) -> str:
    data = ANSI_OSC.sub(b"", data)
    data = ANSI_CSI.sub(b"", data)
    return data.replace(b"\r", b"").decode("utf-8", "replace")


def main() -> int:
    project = pathlib.Path(tempfile.mkdtemp(prefix="cascade-real-tui-"))
    agent_dir = pathlib.Path(tempfile.mkdtemp(prefix="cascade-real-pi-agent-"))
    bin_dir = pathlib.Path(tempfile.mkdtemp(prefix="cascade-real-bin-"))
    raw_log = project / "tui.raw"
    try:
        # Avoid Pi's optional fd download so startup is deterministic and offline.
        fd = bin_dir / "fd"
        fd.write_text('#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fd 10.0.0"; exit 0; fi\nexec find . -type f -print\n', encoding="utf-8")
        fd.chmod(0o755)

        # Reproduce the exact legacy configuration that previously rejected
        # startup before Pi could render the TUI.
        config_dir = project / ".cascade"
        config_dir.mkdir()
        (config_dir / "config.json").write_text(json.dumps({
            "schemaVersion": 1,
            "mode": "dual",
            "worker": {
                "provider": "meta-model-api",
                "model": "muse-spark-1.2-contributor",
                "thinking": "medium",
                "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"],
            },
            "expert": {
                "provider": "openrouter",
                "model": "openrouter/auto",
                "thinking": "high",
                "tools": ["read", "grep", "find", "ls", "bash"],
            },
            "privacy": {"classification": "unknown", "allowContributor": False},
        }, indent=2) + "\n", encoding="utf-8")

        executable = pathlib.Path(
            os.environ.get("CASCADE_TUI_EXECUTABLE", str(ROOT / "bin" / "cascade.mjs"))
        ).resolve()
        package_root = executable.parent.parent
        pi_index = (
            package_root
            / "node_modules"
            / "@earendil-works"
            / "pi-coding-agent"
            / "dist"
            / "index.js"
        )
        if not pi_index.exists():
            raise FileNotFoundError(f"Bundled Pi runtime API not found: {pi_index}")

        proof_extension = project / "proof-extension.mjs"
        proof_extension.write_text(
            f"""import {{ createWriteTool }} from {json.dumps(pi_index.as_uri())};

export default function proofExtension(pi) {{
  pi.registerCommand("cascade-proof-write", {{
    description: "Exercise Pi's real built-in write tool",
    async handler(_args, ctx) {{
      const registered = pi.getAllTools().some((candidate) => candidate.name === "write");
      const active = pi.getActiveTools().includes("write");
      if (!registered || !active) throw new Error("Pi write tool is not registered and active");
      const tool = createWriteTool(ctx.cwd);
      const result = await tool.execute(
        "cascade-proof-write",
        {{ path: "cascade-tui-proof.txt", content: "Cascade real TUI write tool passed.\\n" }},
        ctx.signal
      );
      if (!result?.content?.some((item) => item.type === "text" && item.text?.includes("Successfully wrote"))) {{
        throw new Error("Pi write tool returned an unexpected result");
      }}
      ctx.ui.notify("CASCADE_PROOF_WRITE_OK", "info");
    }}
  }});
}}
""",
            encoding="utf-8",
        )

        env = os.environ.copy()
        for key in list(env):
            if key.endswith("_API_KEY") or key in {"MODEL_API_KEY", "OPENROUTER_API_KEY"}:
                env.pop(key, None)
        env.update({
            "PI_CODING_AGENT_DIR": str(agent_dir),
            "CASCADE_STATE_DIR": str(project / ".state"),
            "PATH": str(bin_dir) + os.pathsep + env.get("PATH", ""),
            "TERM": "xterm-256color",
            "NO_COLOR": "1",
        })

        if executable.suffix == ".mjs":
            command = ["node", str(executable), "--approve", "--extension", str(proof_extension)]
        else:
            command = [str(executable), "--approve", "--extension", str(proof_extension)]

        pid, fd_num = pty.fork()
        if pid == 0:
            os.chdir(project)
            os.execvpe(command[0], command, env)

        transcript = bytearray()

        def read_available(timeout: float = 0.2) -> None:
            ready, _, _ = select.select([fd_num], [], [], timeout)
            if not ready:
                return
            try:
                chunk = os.read(fd_num, 65536)
            except OSError:
                return
            if chunk:
                transcript.extend(chunk)

        def wait_for(*needles: str, timeout: float = 20.0) -> str:
            deadline = time.time() + timeout
            while time.time() < deadline:
                read_available(0.2)
                text = clean(bytes(transcript))
                if any(needle in text for needle in needles):
                    return text
                done, _ = os.waitpid(pid, os.WNOHANG)
                if done:
                    raise RuntimeError(f"Cascade exited before rendering {needles}:\n{text[-5000:]}")
            text = clean(bytes(transcript))
            raise TimeoutError(f"Timed out waiting for {needles}:\n{text[-5000:]}")

        def send(value: bytes) -> None:
            os.write(fd_num, value)

        wait_for("No models available", "Use /login", timeout=25)
        send(b"/cascade-tools\r")
        tools_text = wait_for("nativeToolsAtLoad", timeout=10)
        for expected in ("read", "bash", "edit", "write", "cascade-setup", "cascade-update", "cascade-compaction"):
            if expected not in tools_text:
                raise AssertionError(f"Expected active/native tool or command {expected!r} was missing")

        send(b"/cascade-proof-write\r")
        wait_for("CASCADE_PROOF_WRITE_OK", timeout=10)
        proof_path = project / "cascade-tui-proof.txt"
        if proof_path.read_text(encoding="utf-8") != "Cascade real TUI write tool passed.\n":
            raise AssertionError("Pi's built-in write tool did not create the expected proof file")

        send(b"/cascade-setup\r")
        wait_for("Cascade setup · Operating mode", timeout=10)
        send(b"\x1b")
        time.sleep(0.3)

        send(b"/cascade-compaction\r")
        wait_for("Cascade · Global auto-compaction", timeout=10)
        send(b"\x1b")
        time.sleep(0.3)

        send(b"/cascade-update\r")
        wait_for("Update Cascade?", timeout=10)
        send(b"\x1b")
        time.sleep(0.3)

        send(b"/model\r")
        wait_for("No matching models", "Only showing models", "Select a model", timeout=15)
        send(b"\x1b")
        time.sleep(0.3)

        send(b"/login\r")
        wait_for("Select authentication method", timeout=10)
        send(b"\x1b")
        time.sleep(0.3)

        # Clear any editor state, then exit through Pi's normal keybinding.
        send(b"\x03")
        send(b"\x04")
        deadline = time.time() + 8
        exit_status = None
        while time.time() < deadline:
            read_available(0.2)
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exit_status = status
                break
        if exit_status is None:
            send(b"\x04")
            time.sleep(0.5)
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exit_status = status
        if exit_status is None:
            os.kill(pid, signal.SIGTERM)
            raise TimeoutError("Cascade TUI did not exit through the normal Pi keybinding")
        if not os.WIFEXITED(exit_status) or os.WEXITSTATUS(exit_status) != 0:
            raise RuntimeError(f"Cascade TUI exited abnormally: status={exit_status}")

        raw_log.write_bytes(bytes(transcript))
        print("Real Cascade/Pi TUI smoke test passed without provider credentials.")
        return 0
    finally:
        shutil.rmtree(project, ignore_errors=True)
        shutil.rmtree(agent_dir, ignore_errors=True)
        shutil.rmtree(bin_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
