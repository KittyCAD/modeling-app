import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("check_ids", Path(__file__).resolve().parents[1] / "check_kcl_sample_ids.py")
check_ids = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_ids)

SAMPLE_ID = "151d741b-42ea-4e8d-916d-e5ec3dc80ed4"


class SampleIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.add_sample("first")

    def add_sample(self, name, contents=None):
        directory = self.root / name
        directory.mkdir()
        (directory / "main.kcl").write_text("// Example\n")
        (directory / "project.toml").write_text(
            contents if contents is not None else f'[settings.meta]\nid = "{SAMPLE_ID}"\n'
        )

    def test_accepts_valid_identity_without_manifest(self):
        self.assertEqual(check_ids.sample_ids(self.root), {"first": SAMPLE_ID})

    def test_rejects_missing_project_file(self):
        (self.root / "first/project.toml").unlink()
        with self.assertRaisesRegex(ValueError, "first/project.toml"):
            check_ids.sample_ids(self.root)

    def test_rejects_missing_invalid_or_nonstring_id(self):
        for contents in ['[settings.meta]\n', '[settings.meta]\nid = "bad"\n',
                         '[settings.meta]\nid = 123\n', '[settings.meta]\nid = "00000000-0000-0000-0000-000000000000"\n']:
            with self.subTest(contents=contents):
                (self.root / "first/project.toml").write_text(contents)
                with self.assertRaises(ValueError):
                    check_ids.sample_ids(self.root)

    def test_rejects_malformed_toml(self):
        (self.root / "first/project.toml").write_text("[bad TOML")
        with self.assertRaises(ValueError):
            check_ids.sample_ids(self.root)

    def test_rejects_duplicate_ids_in_new_sample(self):
        self.add_sample("second")
        with self.assertRaisesRegex(ValueError, "also used by first"):
            check_ids.sample_ids(self.root)

    def test_discovers_nested_kcl_and_ignores_asset_directories(self):
        directory = self.root / "first"
        (directory / "main.kcl").unlink()
        (directory / "parts").mkdir()
        (directory / "parts/nested.kcl").write_text("// Example\n")
        (self.root / "screenshots").mkdir()
        (self.root / "screenshots/preview.png").write_bytes(b"PNG")
        self.assertEqual(check_ids.sample_ids(self.root), {"first": SAMPLE_ID})


if __name__ == "__main__":
    unittest.main()
