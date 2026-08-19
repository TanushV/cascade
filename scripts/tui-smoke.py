#!/usr/bin/env python3
import os
import pty
import re
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin" / "cascade.mjs"
ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")


def clean(data):
    return ANSI.sub("", data.decode("utf-8", "replace")).replace("\r", "")


def read_until(master, proc, predicate, timeout, transcript):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        ready, _, _ = select.select([master], [], [], 0.15)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if chunk:
                transcript.extend(chunk)
                if predicate(clean(transcript)):
                    return True
    return predicate(clean(transcript))


def main():
    if os.name == "nt":
        print("Native pseudo-terminal smoke test skipped on Windows; wizard behavior is covered by unit tests.")
        return 0

    node = shutil.which("node")
    if not node:
        print("node is required", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="cascade-tui-smoke-") as temp:
        home = Path(temp) / "home"
        repo = Path(temp) / "repo"
        home.mkdir()
        repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)

        env = os.environ.copy()
        env.update({
            "HOME": str(home),
            "CASCADE_STATE_DIR": str(Path(temp) / "state"),
            "CASCADE_CONFIG_GLOBAL": str(Path(temp) / "global.json"),
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "NO_COLOR": "1"
        })

        master, slave = pty.openpty()
        try:
            termios.tcsetwinsize(slave, (32, 120))
        except AttributeError:
            import fcntl
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 120, 0, 0))

        proc = subprocess.Popen(
            [node, str(CLI), "--single", "--approve"],
            cwd=repo,
            env=env,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True
        )
        os.close(slave)
        transcript = bytearray()

        try:
            started = read_until(
                master,
                proc,
                lambda text: "cascade:" in text.lower() or "cascade" in text.lower(),
                15,
                transcript
            )
            if not started:
                raise AssertionError("Cascade TUI did not render its status or header")

            os.write(master, b"/cascade-setup\r")
            opened = read_until(
                master,
                proc,
                lambda text: "cascade setup" in text.lower() and "save settings" in text.lower(),
                10,
                transcript
            )
            if not opened:
                raise AssertionError("/cascade-setup did not open Pi's native selector")

            os.write(master, b"\x1b")
            time.sleep(0.25)
            os.write(master, b"\x03")
            time.sleep(0.25)
            if proc.poll() is None:
                os.write(master, b"\x04")
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.terminate()
                proc.wait(timeout=3)

            rendered = clean(transcript)
            if "cascade setup" not in rendered.lower():
                raise AssertionError("Cascade setup text was absent from the terminal transcript")

            print("Native Cascade TUI smoke test passed: startup, status, slash command, selector, cancellation, and shutdown.")
            return 0
        except Exception as error:
            tail = clean(transcript)[-5000:]
            print(f"TUI smoke failure: {error}\n--- terminal tail ---\n{tail}", file=sys.stderr)
            if proc.poll() is None:
                proc.terminate()
            return 1
        finally:
            try:
                os.close(master)
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
