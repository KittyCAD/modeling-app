"""Tracing against a local backend, including HTTP rejection and WS failure."""

import asyncio
import base64
import hashlib
import json
import struct
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import kcl
import pytest


@contextmanager
def backend(monkeypatch, *, upgrade=False, header="X-Api-Call-Id", hold=False):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            if not upgrade:
                self.send_response(403)
                self.send_header(header, "rejected-id")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(101)
            self.send_header("Connection", "Upgrade")
            self.send_header("Upgrade", "websocket")
            key = (
                self.headers["Sec-WebSocket-Key"]
                + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            )
            self.send_header(
                "Sec-WebSocket-Accept",
                base64.b64encode(hashlib.sha1(key.encode()).digest()).decode(),
            )
            if header is not None:
                self.send_header(header, "connection-id")
            self.end_headers()
            response = {
                "success": True,
                "request_id": None,
                "resp": {
                    "type": "modeling_session_data",
                    "data": {"session": {"api_call_id": "connection-id"}},
                },
            }
            payload = json.dumps(response).encode()
            self.wfile.write(
                bytes([0x81, 126]) + struct.pack("!H", len(payload)) + payload
            )
            self.wfile.flush()
            if hold:
                self.connection.settimeout(5)
                try:
                    while self.connection.recv(65536):
                        pass
                except (TimeoutError, ConnectionError):
                    pass
            else:
                # The reader consumes the metadata before the close frame.
                self.wfile.write(bytes([0x88, 0]))
                self.wfile.flush()
            self.close_connection = True

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("ZOO_HOST", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("ZOO_API_TOKEN", "local-test-token")
    monkeypatch.delenv("KITTYCAD_API_TOKEN", raising=False)
    try:
        yield
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def calls(path):
    return [
        (kcl.execute_code, ["x = 1"]),
        (kcl.execute, [str(path)]),
        (kcl.execute_code_and_measure, ["x = 1", kcl.PhysicalPropertiesRequest()]),
        (kcl.execute_and_measure, [str(path), kcl.PhysicalPropertiesRequest()]),
        (kcl.execute_code_and_bounding_box, ["x = 1"]),
        (kcl.execute_and_bounding_box, [str(path)]),
        (kcl.execute_code_and_export, ["x = 1", kcl.FileExportFormat.Step]),
        (kcl.execute_and_export, [str(path), kcl.FileExportFormat.Step]),
        (kcl.execute_code_and_snapshot, ["x = 1", kcl.ImageFormat.Png]),
        (kcl.execute_and_snapshot, [str(path), kcl.ImageFormat.Png]),
        (kcl.execute_code_and_snapshot_views, ["x = 1", kcl.ImageFormat.Png, []]),
        (kcl.execute_and_snapshot_views, [str(path), kcl.ImageFormat.Png, []]),
        (kcl.get_sketch_constraint_status_code, ["x = 1"]),
        (kcl.get_sketch_constraint_status, [str(path)]),
        (
            kcl.import_and_snapshot,
            [[], kcl.InputFormat3d.Step(kcl.StepImportOptions()), kcl.ImageFormat.Png],
        ),
        (
            kcl.import_and_snapshot_views,
            [
                [],
                kcl.InputFormat3d.Step(kcl.StepImportOptions()),
                kcl.ImageFormat.Png,
                [],
            ],
        ),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("header", ["X-Api-Call-Id", "x-request-id"])
async def test_rejected_handshakes_for_all_engine_entrypoints(
    monkeypatch, tmp_path, header
):
    path = tmp_path / "main.kcl"
    path.write_text("x = 1")
    with backend(monkeypatch, header=header):
        for fn, args in calls(path):
            trace = kcl.ApiCallTrace()
            with pytest.raises(Exception, match="403"):
                await fn(*args, trace=trace)
            assert trace.api_call_ids == ["rejected-id"], fn.__name__
            snapshot = trace.api_call_ids
            snapshot.clear()
            assert trace.api_call_ids == ["rejected-id"]
            with pytest.raises(AttributeError):
                trace.api_call_ids = []


@pytest.mark.asyncio
async def test_mock_and_parse_failures_have_no_backend_id():
    trace = kcl.ApiCallTrace()
    await kcl.mock_execute_code("x = 1", trace=trace)
    assert trace.api_call_ids == []
    with pytest.raises(kcl.KclError):
        await kcl.execute_code("const =", trace=trace)
    assert trace.api_call_ids == []


@pytest.mark.asyncio
@pytest.mark.parametrize("header", ["X-Api-Call-Id", None])
async def test_metadata_survives_engine_failure_and_deduplicates_handshake(
    monkeypatch, header
):
    with backend(monkeypatch, upgrade=True, header=header):
        trace = kcl.ApiCallTrace()
        with pytest.raises(kcl.KclError):
            await asyncio.wait_for(kcl.execute_code("x = 1", trace=trace), timeout=10)
        assert trace.api_call_ids == ["connection-id"]


@pytest.mark.asyncio
async def test_trace_retains_id_after_cancellation(monkeypatch):
    with backend(monkeypatch, upgrade=True, hold=True, header=None):
        trace = kcl.ApiCallTrace()
        task = asyncio.ensure_future(kcl.execute_code("x = 1", trace=trace))
        async with asyncio.timeout(5):
            while not trace.api_call_ids:
                await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert trace.api_call_ids == ["connection-id"]
