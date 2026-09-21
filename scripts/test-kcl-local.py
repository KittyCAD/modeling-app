#!/usr/bin/env python3
r"""Run engine CI's KCL tests against a pool of prebuilt local engines (Linux/macOS).

From ~/KittyCAD:
  python3 modeling-app/scripts/test-kcl-local.py --engine-dir engine5 --jobs 8
  python3 modeling-app/scripts/test-kcl-local.py --engine-dir engine5 \
      --engine-profile debug --jobs 2 --filter simulation_tests::holes_cube::kcl_test_execute

Requires Python 3.11+, Cargo, cargo-nextest, and a working engine build/runtime.
Builds kcl-lib tests once, but never builds the engine. Defaults follow the
engine repo's kcl-tests-sharded recipe: kcl_test, artifact-graph, CI timeouts,
six retries, and snapshot comparison rather than acceptance. This is the engine
regression subset, not modeling-app's entire Rust workspace CI matrix.
On completion, prints totals/failures and saves every test result in summary.txt.
Shows test progress in the terminal and records phase/test durations in timings.json.
Use --dry-run to list matching tests without starting engines or running tests.
Discovery may compile test binaries; a built engine is not needed for a dry run.
"""

import argparse
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


def arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine-dir", type=Path, required=True, help="Engine repository (relative to current directory)")
    parser.add_argument("--modeling-app-dir", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--engine-profile", choices=("release", "debug"), default="release")
    parser.add_argument("--engine-bin", type=Path, help="Override binary path (relative to engine directory)")
    parser.add_argument("-j", "--jobs", type=int, default=8, help="Number of engines/partitions (default: 8)")
    parser.add_argument("--base-port", type=int, default=3000, help="First API port (default: 3000); metrics use OS-assigned ports")
    parser.add_argument("--filter", default="kcl_test", help="Test name substring (default: kcl_test)")
    parser.add_argument("--dry-run", action="store_true", help="List matching tests and exit; may build tests for discovery, but starts no engines")
    parser.add_argument("--retries", type=int, default=6, help="Retries per failing test, as in engine CI (default: 6)")
    parser.add_argument("--startup-timeout", type=float, default=180, help="Seconds to wait for each engine (default: 180)")
    output_options = parser.add_mutually_exclusive_group()
    output_options.add_argument("--output-dir", type=Path, help="New directory for logs/reports (default: test-results/kcl-YYYY-MM-DD_HH-MM-SS, local time)")
    output_options.add_argument("--name-suffix", default="", help="Append a label to the timestamped directory, e.g. test-edge-fix")
    args = parser.parse_args()
    if args.jobs < 1 or args.retries < 0 or args.startup_timeout <= 0:
        parser.error("jobs and startup-timeout must be positive; retries must be nonnegative")
    if not 1 <= args.base_port <= args.base_port + args.jobs - 1 <= 65535:
        parser.error("API port range must fit within 1..65535")
    if any(char in "/\\" or ord(char) < 32 or ord(char) == 127 for char in args.name_suffix):
        parser.error("name-suffix must not contain path separators or control characters")
    return args


def stop_processes(processes):
    """Stop our process groups, including test children; bound graceful shutdown."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for process in reversed(processes):
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 5
        for process in processes:
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                pass


def wait_ready(process, port, timeout, log):
    # Bypass HTTP proxy settings for localhost.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Engine on port {port} exited ({process.returncode}); see {log}")
        try:
            with opener.open(f"http://127.0.0.1:{port}/stream/ready", timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.25)
    raise RuntimeError(f"Engine on port {port} was not ready within {timeout}s; see {log}")


def worker_config(original, directory):
    """Keep repository CI settings, but isolate nextest storage and JUnit output."""
    config = tomllib.loads(original)
    if "store" in config:
        raise RuntimeError("Repository nextest config now defines [store]; update this script's storage override")
    # Replace only the CI report path, preserving all other settings/comments.
    pattern = r"(?m)(^\[profile\.ci\.junit\]\s*\n)(.*?)(?=^\[|\Z)"

    def report_section(match):
        body, count = re.subn(r"(?m)^path\s*=.*$", lambda _: "path = " + json.dumps(str(directory / "junit.xml")), match[2])
        if count != 1:
            raise RuntimeError("Expected one JUnit path in nextest's CI profile")
        return match[1] + body

    original, count = re.subn(pattern, report_section, original, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError("Expected [profile.ci.junit] in repository nextest config")
    path = directory / "nextest.toml"
    path.write_text("store.dir = " + json.dumps(str(directory / "nextest")) + "\n\n" + original)
    return path


class TestProgress:
    """Read nextest status lines incrementally; JUnit remains the final report."""

    def __init__(self, output, jobs, selected_tests, retries):
        self.paths = [output / f"worker-{index}/tests.log" for index in range(1, jobs + 1)]
        self.offsets = dict.fromkeys(self.paths, 0)
        self.selected = set(selected_tests)
        self.completed = set()
        self.attempts = retries + 1
        self.started = time.monotonic()
        self.last_print = None
        self.terminal = sys.stdout.isatty()

    def update(self, final=False):
        for path in self.paths:
            with path.open("rb") as log:
                log.seek(self.offsets[path])
                while line := log.readline():
                    if not line.endswith(b"\n"):
                        break  # Read an unfinished line again on the next poll.
                    self.offsets[path] = log.tell()
                    match = re.match(
                        r"^\s*(?:TRY\s+(\d+)\s+)?([A-Z][A-Z0-9+-]*)\s+\[[^]]*\]\s+"
                        r"(?:\(\d+/\d+\)\s+)?(.+?)\s*$", line.decode(errors="replace")
                    )
                    if not match:
                        continue
                    attempt, status, name = match.groups()
                    name = " ".join(name.split())
                    if status in ("SLOW", "RETRY", "DELAY", "START", "SKIP") or name not in self.selected:
                        continue
                    if attempt and status not in ("PASS", "LEAK") and int(attempt) < self.attempts:
                        continue
                    self.completed.add(name)
        now = time.monotonic()
        if self.terminal or final or self.last_print is None or now - self.last_print >= 30:
            done, total = len(self.completed), len(self.selected)
            filled = 20 * done // total
            bar = "#" * filled + "-" * (20 - filled)
            message = f"Tests [{bar}] {done}/{total} ({done / total:.0%}) | elapsed {now - self.started:.1f}s"
            print(("\r\033[K" if self.terminal else "") + message,
                  end="" if self.terminal else "\n", flush=True)
            self.last_print = now

    def clear(self):
        if self.terminal:
            print("\r\033[K", end="", flush=True)


def summarize_results(output, jobs, selected, failed, timings):
    """Combine final JUnit outcomes, counting each test once even with retries."""
    counts = dict.fromkeys(("PASS", "FAIL", "ERROR", "SKIP"), 0)
    results = []
    test_timings = []
    warnings = []
    for index in range(1, jobs + 1):
        directory = output / f"worker-{index}"
        try:
            report = ET.parse(directory / "junit.xml")
        except (OSError, ET.ParseError) as error:
            warnings.append(f"worker-{index}: cannot read JUnit report ({error}); see {directory / 'tests.log'}")
            continue
        for case in report.iter("testcase"):
            if case.find("failure") is not None:
                status = "FAIL"
            elif case.find("error") is not None:
                status = "ERROR"
            elif case.find("skipped") is not None:
                status = "SKIP"
            else:
                status = "PASS"
            counts[status] += 1
            name = f"{case.get('classname', '')} {case.get('name', '<unnamed>')}".strip()
            line = f"{status:5} [{case.get('time', '?')}s] {name} (worker-{index})"
            results.append((name, status, line))
            test_timings.append({"name": name, "worker": index, "status": status,
                                 "seconds": float(case.get("time", "0"))})

    reported = sum(counts.values())
    if reported != selected:
        warnings.append(f"Expected {selected} selected tests, but reports contain {reported} results; summary is incomplete.")
    failed = failed or bool(counts["FAIL"] or counts["ERROR"] or warnings)
    header = (
        f"KCL test summary: {'FAIL' if failed else 'PASS'}\n"
        f"Selected: {selected} | Reported: {reported} | Passed: {counts['PASS']} | "
        f"Failed: {counts['FAIL']} | Errors: {counts['ERROR']} | Skipped: {counts['SKIP']}\n"
        f"Wall time: {timings['total_seconds']:.1f}s | Build/discovery: {timings['build_seconds']:.1f}s | "
        f"Engine startup: {timings['engine_startup_seconds']:.1f}s | Tests: {timings['test_seconds']:.1f}s | "
        f"Cleanup: {timings['cleanup_seconds']:.1f}s"
    )
    results.sort()
    details = [line for _, _, line in results]
    failures = [line for _, status, line in results if status in ("FAIL", "ERROR")]
    notes = [f"WARNING: {warning}" for warning in warnings]
    notes.append("Failure details: worker-*/tests.log")
    slowest = ["Slowest tests (JUnit duration):"] + [
        f"  {test['seconds']:.3f}s {test['name']}"
        for test in sorted(test_timings, key=lambda test: test["seconds"], reverse=True)[:10]
    ]
    timings["tests"] = test_timings
    timings["result"] = "FAIL" if failed else "PASS"
    (output / "timings.json").write_text(json.dumps(timings, indent=2) + "\n")
    summary = output / "summary.txt"
    summary.write_text("\n".join([header, "", *details, "", *slowest, "", *notes]) + "\n")
    print("\n".join(["", header, *failures, *slowest, *notes, f"All test results: {summary}",
                     f"Timing data: {output / 'timings.json'}"]), flush=True)
    return failed


def run(args):
    run_started = time.monotonic()
    timings = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "result": "INCOMPLETE"}
    engine = args.engine_dir.expanduser().resolve()
    app = args.modeling_app_dir.expanduser().resolve()
    rust = app / "rust"
    binary = (engine / (args.engine_bin or Path("target") / args.engine_profile / "engine-api")).resolve()
    if not args.dry_run and (not binary.is_file() or not os.access(binary, os.X_OK)):
        raise RuntimeError(f"No executable at {binary}; build it first or select --engine-profile debug / --engine-bin")
    config = (rust / ".config/nextest.toml").read_text()
    # Fail before building if a selected API port is already occupied. Engines
    # still own their binds; an intervening conflict is caught during startup.
    if not args.dry_run:
        for port in range(args.base_port, args.base_port + args.jobs):
            with socket.socket() as probe:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    probe.bind(("127.0.0.1", port))
                except OSError as error:
                    raise RuntimeError(f"Cannot use API port {port}: {error}; choose another --base-port") from error

    if args.output_dir:
        output = args.output_dir.expanduser().resolve()
        output.mkdir(parents=True, exist_ok=False)
    else:
        (app / "test-results").mkdir(exist_ok=True)
        name = time.strftime("kcl-%Y-%m-%d_%H-%M-%S")
        if args.name_suffix:
            name += f"-{args.name_suffix}"
        suffix = 0
        while True:
            output = app / "test-results" / (name if suffix == 0 else f"{name}-{suffix}")
            try:
                output.mkdir()
                break
            except FileExistsError:
                # Preserve distinct runs even when started in the same second.
                suffix += 1
    print(f"Engine: {binary}\nLogs and reports: {output}", flush=True)

    env = os.environ.copy()
    # The local engine needs no real token. Avoid legacy env vars overriding it,
    # and never inherit snapshot-acceptance settings from the user's shell.
    for key in ("KITTYCAD_HOST", "KITTYCAD_API_TOKEN", "EXPECTORATE", "ZOO_SIM_UPDATE"):
        env.pop(key, None)
    env.update(ZOO_API_TOKEN="local", INSTA_UPDATE="no", TWENTY_TWENTY="store-artifact-on-mismatch")
    env.setdefault("SKIP_DEPS", "1")
    env.setdefault("RUST_MIN_STACK", "10485760000")  # Same as engine CI.
    engine_env = env.copy()
    engine_env["ENGINE_WORKING_DIR"] = str(engine)
    # Use the local shader cache; concurrent S3 downloads overwrite its files.
    engine_env.pop("ENGINE_SHADER_CACHE_BUCKET", None)
    engine_env.pop("ZOO_ENGINE_YOLO", None)
    library_dir = engine / "target/_deps/toolpaths/target/release"
    engine_env["LD_LIBRARY_PATH"] = str(library_dir) + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")

    processes = []
    progress = None
    phase = "build_seconds"
    phase_started = time.monotonic()

    def start(command, cwd, environment, log, stdout=None):
        with log.open("wb") as stderr:
            process = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                       stdout=stdout if stdout is not None else stderr, stderr=stderr,
                                       start_new_session=True)
        processes.append(process)
        return process

    try:
        # Reuse nextest's build metadata, avoiding a rebuild or archive extraction
        # per worker. Cargo resolves/builds using modeling-app's toolchain/config.
        print("Building KCL tests once (see build.log)...", flush=True)
        binaries = output / "binaries.json"
        metadata = output / "cargo-metadata.json"
        for command, destination, log_name in (
            (["cargo", "metadata", "--format-version=1"], metadata, "metadata.log"),
            (["cargo", "nextest", "list", "-p", "kcl-lib", "--features=artifact-graph",
              "--list-type=binaries-only", "--message-format=json"], binaries, "build.log"),
        ):
            with destination.open("wb") as handle:
                process = start(command, rust, env, output / log_name, stdout=handle)
                if process.wait() != 0:
                    raise RuntimeError(f"Test build/metadata failed; see {output / log_name}")

        reuse = ["--cargo-metadata", str(metadata), "--binaries-metadata", str(binaries)]
        listing = output / "tests.json"
        with listing.open("wb") as handle:
            process = start(["cargo", "nextest", "list", *reuse, "--profile=ci",
                             "--message-format=json", "--", args.filter],
                            rust, env, output / "list.log", stdout=handle)
            if process.wait() != 0:
                raise RuntimeError(f"Test discovery failed; see {output / 'list.log'}")
        selected_tests = sorted(
            f"{suite['binary-id']} {name}"
            for suite in json.loads(listing.read_text())["rust-suites"].values()
            for name, test in suite["testcases"].items()
            if not test["ignored"] and test["filter-match"]["status"] == "matches"
        )
        selected = len(selected_tests)
        if not selected:
            raise RuntimeError(f"No tests match {args.filter!r}")
        if args.dry_run:
            report = "\n".join([
                f"Dry run: {selected} tests would run (filter: {args.filter!r})",
                *selected_tests,
                "No engines started or tests executed.",
            ]) + "\n"
            path = output / "dry-run.txt"
            path.write_text(report)
            print(f"{report}Test list saved to: {path}", flush=True)
            timings["result"] = "DRY_RUN"
            return 0
        print(f"Selected {selected} tests", flush=True)
        timings[phase] = time.monotonic() - phase_started
        phase, phase_started = "engine_startup_seconds", time.monotonic()

        workers = []
        for index in range(1, args.jobs + 1):
            directory = output / f"worker-{index}"
            directory.mkdir()
            cfg = worker_config(config, directory)
            port = args.base_port + index - 1
            engine_log = directory / "engine.log"
            process = start([str(binary), "server", "--public-address", f"127.0.0.1:{port}",
                             "--metrics-address", "127.0.0.1:0"], engine, engine_env, engine_log)
            wait_ready(process, port, args.startup_timeout, engine_log)
            print(f"Engine {index}/{args.jobs} ready on port {port}", flush=True)
            workers.append((index, port, process, directory, cfg))

        timings[phase] = time.monotonic() - phase_started
        phase, phase_started = "test_seconds", time.monotonic()
        pending = []
        for index, port, engine_process, directory, cfg in workers:
            worker_env = dict(env, ZOO_HOST=f"http://127.0.0.1:{port}")
            command = ["cargo", "nextest", "run", *reuse, "--config-file", str(cfg), "--profile=ci",
                       "--test-threads=1", f"--retries={args.retries}", "--no-fail-fast", "--no-tests=pass",
                       "--color=never", "--status-level=pass", "--final-status-level=none",
                       "--success-output=never", "--failure-output=final", "--message-format=human",
                       f"--partition=count:{index}/{args.jobs}", "--", args.filter]
            test_process = start(command, rust, worker_env, directory / "tests.log")
            pending.append((index, engine_process, test_process, directory))
        print(f"Running {args.jobs} partitions; follow worker-*/tests.log for test progress.", flush=True)
        progress = TestProgress(output, args.jobs, selected_tests, args.retries)
        failed = False
        while pending:
            for worker in pending[:]:
                index, engine_process, test_process, directory = worker
                if engine_process.poll() is not None:
                    raise RuntimeError(f"Engine {index} exited during testing; see {directory / 'engine.log'}")
                code = test_process.poll()
                if code is not None:
                    failed |= code != 0
                    progress.clear()
                    print(f"Partition {index}: {'PASS' if code == 0 else f'FAIL (exit {code})'} - {directory / 'tests.log'}", flush=True)
                    pending.remove(worker)
            progress.update(final=not pending)
            if pending:
                time.sleep(0.5)
    finally:
        timings[phase] = time.monotonic() - phase_started
        if progress:
            progress.clear()
        cleanup_started = time.monotonic()
        stop_processes(processes)
        timings["cleanup_seconds"] = time.monotonic() - cleanup_started
        timings["total_seconds"] = time.monotonic() - run_started
        timings["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        (output / "timings.json").write_text(json.dumps(timings, indent=2) + "\n")
    failed = summarize_results(output, args.jobs, selected, failed, timings)
    return 1 if failed else 0


if __name__ == "__main__":
    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        sys.exit(run(arguments()))
    except KeyboardInterrupt:
        print("Interrupted; stopped local engines and test runners.", file=sys.stderr)
        sys.exit(130)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
