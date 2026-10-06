import importlib.util
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import sys
import threading
import unittest
from unittest.mock import Mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

spec = importlib.util.spec_from_file_location("sync", Path(__file__).resolve().parents[1] / "sync_kcl_samples.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

SAMPLE_ID = "151d741b-42ea-4e8d-916d-e5ec3dc80ed4"

PROJECT_ID = "11111111-1111-4111-8111-111111111111"


class FakeApi:
    base_url = "https://example.test"

    def __init__(self):
        self.writes = []
        self.revision = "r1"
        self.fail = False
        self.fail_review = False
        self.submissions = []
        self.status = "draft"
        self.remote_projects = []
        self.lose_create_response = False

    def categories(self):
        return [{"display_name": "Tools", "id": "22222222-2222-4222-8222-222222222222"}]

    def projects(self):
        return self.remote_projects

    def request(self, method, path, body=None, files=None):
        if path == "/user":
            return {"id": "owner-1"}
        if path.endswith("/publish"):
            if self.fail_review:
                raise RuntimeError("Review submission failed")
            self.submissions.append(path)
            self.status = "pending_review"
            return {"id": PROJECT_ID, "revision": self.revision, "publication_status": self.status}
        if method == "GET":
            return {"revision": self.revision, "publication_status": self.status}
        if self.fail:
            raise RuntimeError("HTTP 500")
        self.writes.append((method, path, dict(body), dict(files)))
        if method == "POST":
            self.remote_projects.append({"id": PROJECT_ID})
            if self.lose_create_response:
                raise RuntimeError("Create response lost")
        return {"id": PROJECT_ID, "revision": self.revision}


class SampleSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "samples"
        (self.root / "gauge").mkdir(parents=True)
        (self.root / "gauge/main.kcl").write_text("cube()")
        (self.root / "gauge/old.kcl").write_text("old")
        (self.root / "gauge/project.toml").write_text(f'[settings.app]\n[settings.meta]\nid = "{SAMPLE_ID}"\n')
        (self.root / "screenshots").mkdir()
        (self.root / "screenshots/gauge.png").write_bytes(b"PNG")
        self.sample = {"pathFromProjectDirectoryToFirstFile": "gauge/main.kcl", "title": "Gauge",
                       "description": "A gauge", "categories": ["Tools"], "files": ["main.kcl"]}
        self.manifest()
        self.state = Path(self.temp.name) / "state.json"
        self.api = FakeApi()

    def manifest(self):
        (self.root / "manifest.json").write_text(json.dumps([self.sample]))

    def test_create_skip_update_and_removed_file(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        self.assertEqual(self.api.writes[0][0], "POST")
        self.assertEqual(self.api.writes[0][2]["publication_status"], "draft")
        self.assertEqual(self.api.writes[0][3]["thumbnail.png"], b"PNG")
        sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 1)
        (self.root / "gauge/old.kcl").unlink()
        sync.sync(self.root, self.state, self.api)
        update = self.api.writes[-1]
        self.assertEqual(update[:2], ("PUT", "/user/projects/" + PROJECT_ID))
        self.assertEqual(update[2]["expected_revision"], "r1")
        self.assertEqual(update[2]["deleted_paths"], ["old.kcl"])
        self.assertNotIn("publication_status", update[2])

    def test_directory_and_title_rename_preserves_api_project_id(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        (self.root / "gauge").rename(self.root / "renamed-gauge")
        (self.root / "screenshots/gauge.png").rename(self.root / "screenshots/renamed-gauge.png")
        self.sample["pathFromProjectDirectoryToFirstFile"] = "renamed-gauge/main.kcl"
        self.manifest()
        sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 1)  # Directory rename alone is unchanged content.
        self.sample["title"] = "Renamed Gauge"
        self.manifest()
        sync.sync(self.root, self.state, self.api)
        self.assertEqual(self.api.writes[-1][:2], ("PUT", "/user/projects/" + PROJECT_ID))
        state = json.loads(self.state.read_text())
        self.assertEqual(list(state["samples"]), [SAMPLE_ID])
        self.assertEqual(state["samples"][SAMPLE_ID]["slug"], "renamed-gauge")
        self.assertEqual(state["samples"][SAMPLE_ID]["project_id"], PROJECT_ID)

    def test_legacy_slug_checkpoint_migrates_without_creating_project(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        state = json.loads(self.state.read_text())
        state["version"] = 1
        state["samples"] = {"gauge": state["samples"][SAMPLE_ID]}
        self.state.write_text(json.dumps(state))
        sync.sync(self.root, self.state, self.api)
        migrated = json.loads(self.state.read_text())
        self.assertEqual(migrated["version"], 2)
        self.assertEqual(migrated["samples"][SAMPLE_ID]["project_id"], PROJECT_ID)
        self.assertEqual(len(self.api.writes), 1)

    def test_remote_edit_blocks_update(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        (self.root / "gauge/main.kcl").write_text("changed")
        self.api.revision = "human-edit"
        with self.assertRaisesRegex(ValueError, "remote revision changed"):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 1)

    def test_checkpoint_survives_failure(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        before = self.state.read_bytes()
        self.api.fail = True
        (self.root / "gauge/main.kcl").write_text("changed")
        with self.assertRaises(RuntimeError):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(self.state.read_bytes(), before)

    def test_missing_or_wrong_account_state_blocks_writes(self):
        with self.assertRaisesRegex(ValueError, "Missing state"):
            sync.sync(self.root, self.state, self.api)
        sync.sync(self.root, self.state, self.api, initialize=True)
        state = json.loads(self.state.read_text())
        state["owner_id"] = "another-owner"
        self.state.write_text(json.dumps(state))
        with self.assertRaisesRegex(ValueError, "another API/account"):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 1)

    def test_unknown_category_fails_before_create(self):
        self.sample["categories"] = ["Unknown"]
        self.manifest()
        with self.assertRaisesRegex(ValueError, "unmapped categories"):
            sync.sync(self.root, self.state, self.api, initialize=True)
        self.assertEqual(self.api.writes, [])

    def test_initialize_refuses_account_with_existing_projects(self):
        self.api.remote_projects = [{"id": PROJECT_ID}]
        with self.assertRaisesRegex(ValueError, "Untracked cloud projects: " + PROJECT_ID):
            sync.sync(self.root, self.state, self.api, initialize=True)
        self.assertFalse(self.state.exists())
        self.assertEqual(self.api.writes, [])
        self.assertEqual(self.api.submissions, [])

    def test_stale_checkpoint_blocks_writes_even_for_selected_sample(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        self.api.remote_projects.append({"id": "33333333-3333-4333-8333-333333333333"})
        before = self.state.read_bytes()
        (self.root / "gauge/main.kcl").write_text("changed")
        with self.assertRaisesRegex(ValueError, "Untracked cloud projects"):
            sync.sync(self.root, self.state, self.api, selected={"gauge"})
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(len(self.api.writes), 1)
        self.assertEqual(len(self.api.submissions), 1)

    def test_lost_create_response_does_not_create_duplicate_on_retry(self):
        self.api.lose_create_response = True
        with self.assertRaisesRegex(RuntimeError, "Create response lost"):
            sync.sync(self.root, self.state, self.api, initialize=True)
        self.assertEqual(json.loads(self.state.read_text())["samples"], {})
        self.api.lose_create_response = False
        with self.assertRaisesRegex(ValueError, "Untracked cloud projects: " + PROJECT_ID):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 1)
        self.assertEqual(self.api.submissions, [])

    def test_missing_remote_project_blocks_unchanged_skip(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        self.api.remote_projects.clear()
        before = self.state.read_bytes()
        with self.assertRaisesRegex(ValueError, "Checkpoint cloud projects missing"):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(len(self.api.writes), 1)

    def test_multiple_sample_uuids_cannot_share_cloud_project(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        state = json.loads(self.state.read_text())
        state["samples"]["44444444-4444-4444-8444-444444444444"] = dict(state["samples"][SAMPLE_ID])
        self.state.write_text(json.dumps(state))
        before = self.state.read_bytes()
        with self.assertRaisesRegex(ValueError, "mapped to multiple sample UUIDs"):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(len(self.api.writes), 1)

    def test_metadata_and_preview_changes_are_not_skipped(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        self.sample["title"] = "New title"
        self.manifest()
        sync.sync(self.root, self.state, self.api)
        (self.root / "screenshots/gauge.png").write_bytes(b"new PNG")
        sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 3)

    def test_review_submission_failure_retries_without_another_upload(self):
        self.api.fail_review = True
        with self.assertRaisesRegex(RuntimeError, "Review submission failed"):
            sync.sync(self.root, self.state, self.api, initialize=True)
        state = json.loads(self.state.read_text())["samples"][SAMPLE_ID]
        self.assertEqual(state["project_id"], PROJECT_ID)
        self.assertNotIn("submitted_revision", state)
        self.api.fail_review = False
        sync.sync(self.root, self.state, self.api)
        sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 1)
        self.assertEqual(len(self.api.submissions), 1)

    def test_existing_draft_checkpoint_is_submitted_without_reupload(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        state = json.loads(self.state.read_text())
        del state["samples"][SAMPLE_ID]["submitted_revision"]
        self.state.write_text(json.dumps(state))
        sync.sync(self.root, self.state, self.api)
        self.assertEqual(len(self.api.writes), 1)
        self.assertEqual(len(self.api.submissions), 2)

    def test_changed_published_sample_is_submitted_again(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        self.api.status = "published"
        self.api.revision = "r1"
        (self.root / "gauge/main.kcl").write_text("changed")
        sync.sync(self.root, self.state, self.api)
        self.assertEqual(self.api.writes[-1][0], "PUT")
        self.assertEqual(len(self.api.submissions), 2)

    def test_remote_edit_blocks_retry_of_review_submission(self):
        self.api.fail_review = True
        with self.assertRaises(RuntimeError):
            sync.sync(self.root, self.state, self.api, initialize=True)
        self.api.fail_review = False
        self.api.revision = "human-edit"
        with self.assertRaisesRegex(ValueError, "remote revision changed"):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(self.api.submissions, [])

    def test_dry_run_does_not_write_state(self):
        sync.sync(self.root, self.state)
        self.assertFalse(self.state.exists())

    def test_unknown_sample_and_path_traversal(self):
        with self.assertRaisesRegex(ValueError, "Unknown samples"):
            sync.sync(self.root, self.state, selected={"missing"})
        with self.assertRaisesRegex(ValueError, "Unsafe sample path"):
            sync.read_file(self.root, "../outside.kcl")

    def test_multipart_matches_api_contract(self):
        data, content_type = sync.multipart({"title": "Gauge"}, {"main.kcl": b"cube()"})
        self.assertIn(b'name="body"', data)
        self.assertIn(b'name="file-0"; filename="main.kcl"', data)
        self.assertIn(b"cube()", data)
        self.assertTrue(content_type.startswith("multipart/form-data; boundary="))

    def test_project_inventory_reads_all_pages(self):
        api = sync.Api("https://example.test", "test-token")
        first = {"id": PROJECT_ID}
        second = {"id": "33333333-3333-4333-8333-333333333333"}
        api.request = Mock(side_effect=[
            {"items": [first], "next_page": "a/b+c"},
            {"items": [first, second], "next_page": None},
        ])
        self.assertEqual(api.projects(), [first, second])
        self.assertEqual(api.request.call_args_list[1].args, ("GET", "/user/projects?page_token=a%2Fb%2Bc"))

    def test_project_inventory_accepts_legacy_array(self):
        api = sync.Api("https://example.test", "test-token")
        api.request = Mock(return_value=[{"id": PROJECT_ID}])
        self.assertEqual(api.projects(), [{"id": PROJECT_ID}])
        api.request.assert_called_once_with("GET", "/user/projects")

    def test_project_inventory_rejects_incomplete_or_invalid_pages(self):
        for page in [{}, {"items": []}, {"items": [], "next_page": ""},
                     {"items": [{"id": "bad-id"}], "next_page": None},
                     {"items": [{}], "next_page": None}, {"items": None, "next_page": None}]:
            with self.subTest(page=page):
                api = sync.Api("https://example.test", "test-token")
                api.request = Mock(return_value=page)
                with self.assertRaises(ValueError):
                    api.projects()

    def test_project_inventory_rejects_repeated_cursor(self):
        api = sync.Api("https://example.test", "test-token")
        api.request = Mock(return_value={"items": [], "next_page": "same-page"})
        with self.assertRaisesRegex(ValueError, "pagination cursor"):
            api.projects()
        self.assertEqual(api.request.call_count, 2)

    def test_inventory_failure_blocks_writes_and_preserves_checkpoint(self):
        sync.sync(self.root, self.state, self.api, initialize=True)
        before = self.state.read_bytes()
        (self.root / "gauge/main.kcl").write_text("changed")
        self.api.projects = Mock(side_effect=RuntimeError("Inventory unavailable"))
        with self.assertRaisesRegex(RuntimeError, "Inventory unavailable"):
            sync.sync(self.root, self.state, self.api)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(len(self.api.writes), 1)

    def test_real_http_upload_then_update_uses_flattened_project_response(self):
        writes = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, data, status=200):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def do_GET(self):
                if self.path == "/user":
                    self.reply({"id": "owner-1"})
                elif self.path == "/projects/categories":
                    self.reply([{"display_name": "Tools", "id": "category-1"}])
                elif self.path == "/user/projects":
                    self.reply([{"id": PROJECT_ID}] if writes else [])
                else:
                    self.reply({"id": PROJECT_ID, "revision": "r1", "publication_status": "draft"})

            def upload(self):
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                message = BytesParser().parsebytes(
                    ("Content-Type: " + self.headers["Content-Type"] + "\r\n\r\n").encode() + raw
                )
                parts = message.get_payload()
                body = json.loads(parts[0].get_payload(decode=True))
                files = {part.get_filename(): part.get_payload(decode=True) for part in parts[1:]}
                writes.append((self.command, self.path, body, files, self.headers["Authorization"], self.headers["User-Agent"]))
                self.reply({"id": PROJECT_ID, "revision": "r1", "publication_status": "draft"},
                           201 if self.command == "POST" else 200)

            def do_POST(self):
                if self.path.endswith("/publish"):
                    self.reply({"id": PROJECT_ID, "revision": "r1", "publication_status": "pending_review"})
                else:
                    self.upload()
            do_PUT = upload

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            api = sync.Api(f"http://127.0.0.1:{server.server_port}", "test-token")
            sync.sync(self.root, self.state, api, initialize=True)
            (self.root / "gauge/main.kcl").write_text("changed")
            sync.sync(self.root, self.state, api)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual([write[0] for write in writes], ["POST", "PUT"])
        self.assertEqual(writes[0][3]["main.kcl"], b"cube()")
        self.assertEqual(writes[1][2]["expected_revision"], "r1")
        self.assertEqual(writes[1][3]["main.kcl"], b"changed")
        self.assertEqual(writes[0][4], "Bearer test-token")
        self.assertEqual(writes[0][5], "Zoo-KCL-Sample-Sync/0.1")


if __name__ == "__main__":
    unittest.main()
