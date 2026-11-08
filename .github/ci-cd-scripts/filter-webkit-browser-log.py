"""Keep browser shutdown diagnostics without emitting browser stderr payloads."""

import re
import sys
from datetime import datetime, timezone

ANSI = re.compile(r"\x1b\[[0-9;]*m")
# Allow only fixed lifecycle messages and numeric process IDs/exit information.
# In particular, never forward [err] lines, launch arguments, or URLs.
LIFECYCLE = re.compile(
    r"\[pid=(\d+)\]\s*("
    r"<gracefully close start>|<gracefully close end>|<kill>|<will force kill>|"
    r"<process did exit: exitCode=(?:\d+|null), signal=(?:[A-Z0-9]+|null)>|"
    r"starting temporary directories cleanup|finished temporary directories cleanup"
    r")"
)

for line in sys.stdin:
    plain = ANSI.sub("", line)
    if "pw:browser" not in plain:
        sys.stderr.write(line)
        sys.stderr.flush()
        continue
    match = LIFECYCLE.search(plain)
    if match:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        print(
            f"[webkit-browser-lifecycle] {timestamp} pid={match[1]} {match[2]}",
            file=sys.stderr,
            flush=True,
        )
