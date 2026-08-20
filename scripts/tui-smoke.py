#!/usr/bin/env python3
import argparse
import errno
import fcntl
import json
import os
import re
import select
import signal
import struct
import termios
import time
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
default_root = str(Path(__file__).resolve().parents[1])
parser.add_argument("--root", default=default_root)
parser.add_argument("--cwd")
parser.add_argument("--home")
args = parser.parse_args()
if not args.cwd:
    args.cwd = tempfile.mkdtemp(prefix="cascade-tui-project-")
if not args.home:
    args.home = tempfile.mkdtemp(prefix="cascade-tui-home-")

env = os.environ.copy()
env.update({"HOME": args.home, "TERM": "xterm-256color", "PI_OFFLINE": "1"})
for key in list(env):
    if key.endswith("_API_KEY") or key in {"MODEL_API_KEY", "OPENROUTER_API_KEY"}:
        env.pop(key, None)

pid, fd = os.forkpty()
if pid == 0:
    os.chdir(args.cwd)
    os.execvpe("node", ["node", os.path.join(args.root, "bin", "cascade.mjs"), "--offline", "--no-session"], env)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 150, 0, 0))
os.set_blocking(fd, False)
chunks = []

def drain(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
            if not data:
                break
            chunks.append(data)
        except OSError as error:
            if error.errno not in {errno.EIO, errno.EAGAIN}:
                raise
            if error.errno == errno.EIO:
                break

def send(data):
    os.write(fd, data)

drain(2.5)
send(b"\x0f")  # ctrl+o, expand startup/help if available
drain(0.5)
send(b"/cascade\r")
drain(0.8)
send(b"/cascade-mode dual\r")
drain(1.0)
send(b"/cascade\r")
drain(0.8)
send(b"\x04")
drain(0.2)
send(b"\x04")
drain(1.0)

try:
    waited, status = os.waitpid(pid, os.WNOHANG)
    if waited == 0:
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.2)
        waited, status = os.waitpid(pid, os.WNOHANG)
        if waited == 0:
            os.kill(pid, signal.SIGKILL)
            _, status = os.waitpid(pid, 0)
except ProcessLookupError:
    status = 0

raw = b"".join(chunks).decode("utf-8", "replace")
plain = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", raw)
plain = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", plain).replace("\r", "")
report = {
    "hasCascadeBrand": "Cascade" in plain,
    "hasOldPiHeader": "pi v0.84.2" in plain.lower(),
    "hasPiContext": "PI_ONLY_CONTEXT_SENTINEL" in plain,
    "hasNativeModelHint": "/model · /cascade-setup" in plain,
    "hasClearSingleStatus": "Single · Worker:" in plain,
    "hasClearDualStatus": "Dual · Active Worker:" in plain and "Expert: on-demand" in plain,
    "hasCrypticStatus": bool(re.search(r"worker · (?:single|dual) · route ", plain)),
    "tail": plain[-7000:]
}
if (
    not report["hasCascadeBrand"]
    or report["hasOldPiHeader"]
    or report["hasPiContext"]
    or not report["hasNativeModelHint"]
    or not report["hasClearSingleStatus"]
    or not report["hasClearDualStatus"]
    or report["hasCrypticStatus"]
):
    print(json.dumps(report))
    raise SystemExit(1)
print(json.dumps(report))
