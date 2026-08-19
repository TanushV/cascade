#!/usr/bin/env python3
"""Run a complete offline Cascade/Pi TUI agent turn with a local fake model."""
from __future__ import annotations

import http.server
import json
import os
import pathlib
import pty
import re
import select
import shutil
import signal
import socketserver
import sys
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
ANSI_CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
ANSI_OSC = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)")


def clean(data: bytes) -> str:
    data = ANSI_OSC.sub(b"", data)
    data = ANSI_CSI.sub(b"", data)
    return data.replace(b"\r", b"").decode("utf-8", "replace")


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class OfflineModelHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    requests: list[dict] = []

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        payload = json.loads(body or b"{}")
        self.__class__.requests.append(payload)
        messages = payload.get("messages") or []
        has_tool_result = any(message.get("role") == "tool" for message in messages)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        created = int(time.time())
        if not has_tool_result:
            chunks = [
                {
                    "id": "chatcmpl-cascade-offline",
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": "offline-coder",
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "role": "assistant",
                            "tool_calls": [{
                                "index": 0,
                                "id": "call_write_proof",
                                "type": "function",
                                "function": {
                                    "name": "write",
                                    "arguments": json.dumps({
                                        "path": "offline-agent-proof.txt",
                                        "content": "Offline Cascade agent edit passed.\n",
                                    }),
                                },
                            }],
                        },
                        "finish_reason": None,
                    }],
                },
                {
                    "id": "chatcmpl-cascade-offline",
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": "offline-coder",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
                    "usage": {"prompt_tokens": 120, "completion_tokens": 20, "total_tokens": 140},
                },
            ]
        else:
            chunks = [
                {
                    "id": "chatcmpl-cascade-offline-final",
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": "offline-coder",
                    "choices": [{
                        "index": 0,
                        "delta": {"role": "assistant", "content": "Completed offline edit successfully."},
                        "finish_reason": None,
                    }],
                },
                {
                    "id": "chatcmpl-cascade-offline-final",
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": "offline-coder",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 170, "completion_tokens": 8, "total_tokens": 178},
                },
            ]

        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode("utf-8"))
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True


def main() -> int:
    project = pathlib.Path(tempfile.mkdtemp(prefix="cascade-agent-tui-"))
    agent_dir = pathlib.Path(tempfile.mkdtemp(prefix="cascade-agent-pi-"))
    bin_dir = pathlib.Path(tempfile.mkdtemp(prefix="cascade-agent-bin-"))
    server = ThreadingServer(("127.0.0.1", 0), OfflineModelHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        fd_path = bin_dir / "fd"
        fd_path.write_text('#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fd 10.0.0"; exit 0; fi\nexec find . -type f -print\n', encoding="utf-8")
        fd_path.chmod(0o755)

        port = server.server_address[1]
        config_dir = project / ".cascade"
        config_dir.mkdir()
        config = {
            "schemaVersion": 1,
            "mode": "single",
            "worker": {
                "selectionMode": "configured",
                "thinkingMode": "configured",
                "provider": "offline-test",
                "model": "offline-coder",
                "thinking": "off",
                "restrictTools": False,
            },
            "providers": {
                "offline-test": {
                    "name": "Offline Test Model",
                    "baseUrl": f"http://127.0.0.1:{port}/v1",
                    "apiKey": "offline-test-key",
                    "api": "openai-completions",
                    "authHeader": False,
                    "headers": {},
                    "models": [{
                        "id": "offline-coder",
                        "name": "Offline Coder",
                        "reasoning": False,
                        "input": ["text"],
                        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                        "contextWindow": 32768,
                        "maxTokens": 4096,
                    }],
                },
            },
            "privacy": {"classification": "confidential", "allowContributor": False},
            "routing": {"autoConsult": False},
            "verification": {"requireBeforeCompletion": False},
        }
        (config_dir / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

        executable = pathlib.Path(os.environ.get("CASCADE_TUI_EXECUTABLE", str(ROOT / "bin" / "cascade.mjs"))).resolve()
        command = ["node", str(executable), "--approve"] if executable.suffix == ".mjs" else [str(executable), "--approve"]
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

        def wait_for(*needles: str, timeout: float = 25.0) -> str:
            deadline = time.time() + timeout
            while time.time() < deadline:
                read_available(0.2)
                text = clean(bytes(transcript))
                if any(needle in text for needle in needles):
                    return text
                done, _ = os.waitpid(pid, os.WNOHANG)
                if done:
                    raise RuntimeError(f"Cascade exited before rendering {needles}:\n{text[-7000:]}")
            text = clean(bytes(transcript))
            raise TimeoutError(f"Timed out waiting for {needles}:\n{text[-7000:]}")

        wait_for("Pi can explain its own features", timeout=25)
        time.sleep(1.0)
        os.write(fd_num, b"Create the requested proof file using the write tool.\r")
        final_text = wait_for("Completed offline edit successfully.", timeout=30)
        proof = project / "offline-agent-proof.txt"
        if not proof.exists() or proof.read_text(encoding="utf-8") != "Offline Cascade agent edit passed.\n":
            raise AssertionError(f"The real agent loop did not create the expected file. Transcript:\n{final_text[-7000:]}")
        if len(OfflineModelHandler.requests) < 2:
            raise AssertionError("The local model did not receive a follow-up request containing the tool result")
        if not any(message.get("role") == "tool" for message in OfflineModelHandler.requests[-1].get("messages", [])):
            raise AssertionError("The second model request did not contain Pi's write-tool result")

        os.write(fd_num, b"\x03\x04")
        deadline = time.time() + 8
        exit_status = None
        while time.time() < deadline:
            read_available(0.2)
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exit_status = status
                break
        if exit_status is None:
            os.write(fd_num, b"\x04")
            time.sleep(0.5)
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exit_status = status
        if exit_status is None:
            os.kill(pid, signal.SIGTERM)
            raise TimeoutError("Cascade agent TUI did not exit cleanly")
        if not os.WIFEXITED(exit_status) or os.WEXITSTATUS(exit_status) != 0:
            raise RuntimeError(f"Cascade agent TUI exited abnormally: {exit_status}")

        print("Offline end-to-end Cascade/Pi TUI agent edit passed without external credentials.")
        return 0
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(project, ignore_errors=True)
        shutil.rmtree(agent_dir, ignore_errors=True)
        shutil.rmtree(bin_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
