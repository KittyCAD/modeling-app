#!/usr/bin/env python3
import os

import kcl
import pytest

# Get the path to this script's parent directory.
files_dir = os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "files")
kcl_dir = os.path.join(
    os.path.dirname(os.path.realpath(__file__)), "..", "..", "kcl-lib"
)
tests_dir = os.path.join(kcl_dir, "tests")
lego_file = os.path.join(kcl_dir, "e2e", "executor", "inputs", "lego.kcl")
walkie_talkie_dir = os.path.join(
    os.path.dirname(os.path.realpath(__file__)),
    "..",
    "..",
    "..",
    "public",
    "kcl-samples",
    "walkie-talkie",
)


@pytest.mark.asyncio
async def test_kcl_execute_with_exception():
    # Read from a file.
    try:
        await kcl.execute(os.path.join(files_dir, "parse_file_error"))
    except Exception as e:
        assert e is not None
        assert len(str(e)) > 0
        assert "lksjndflsskjfnak;jfna##" in str(e)


@pytest.mark.asyncio
async def test_kcl_execute():
    # Read from a file.
    await kcl.execute(lego_file)


@pytest.mark.asyncio
async def test_kcl_execute_code():
    # Read from a file.
    with open(lego_file, "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0
        await kcl.execute_code(code)


@pytest.mark.asyncio
async def test_kcl_execute_code_and_snapshot():
    # Read from a file.
    with open(lego_file, "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0
        image_bytes = await kcl.execute_code_and_snapshot(code, kcl.ImageFormat.Jpeg)
        assert image_bytes is not None
        assert len(image_bytes) > 0


@pytest.mark.asyncio
async def test_kcl_execute_code_and_export():
    # Read from a file.
    with open(lego_file, "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0
        files = await kcl.execute_code_and_export(code, kcl.FileExportFormat.Step)
        assert files is not None
        assert len(files) > 0
        assert files[0] is not None
        name = files[0].name
        contents = files[0].contents
        assert name is not None
        assert len(name) > 0
        assert contents is not None
        assert len(contents) > 0


@pytest.mark.asyncio
async def test_kcl_execute_dir_assembly():
    # Read from a file.
    await kcl.execute(walkie_talkie_dir)


@pytest.mark.asyncio
async def test_kcl_execute_and_snapshot():
    # Read from a file.
    image_bytes = await kcl.execute_and_snapshot(lego_file, kcl.ImageFormat.Jpeg)
    assert image_bytes is not None
    assert len(image_bytes) > 0


@pytest.mark.asyncio
async def test_kcl_execute_and_snapshot_dir():
    # Read from a file.
    image_bytes = await kcl.execute_and_snapshot(
        walkie_talkie_dir, kcl.ImageFormat.Jpeg
    )
    assert image_bytes is not None
    assert len(image_bytes) > 0


@pytest.mark.asyncio
async def test_kcl_execute_and_export():
    # Read from a file.
    files = await kcl.execute_and_export(lego_file, kcl.FileExportFormat.Step)
    assert files is not None
    assert len(files) > 0
    assert files[0] is not None
    name = files[0].name
    contents = files[0].contents
    assert name is not None
    assert len(name) > 0
    assert contents is not None
    assert len(contents) > 0


def test_kcl_format():
    # Read from a file.
    with open(lego_file, "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0
        formatted_code = kcl.format(code)
        assert formatted_code is not None
        assert len(formatted_code) > 0

@pytest.mark.asyncio
async def test_kcl_format_dir():
    await kcl.format_dir(walkie_talkie_dir)

def test_kcl_lint():
    # Read from a file.
    with open(os.path.join(files_dir, "box_with_linter_errors.kcl"), "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0
        lints = kcl.lint(code)
        assert lints is not None
        assert len(lints) > 0
        description = lints[0].description
        assert description is not None
        assert len(description) > 0
        finding = lints[0].finding
        assert finding is not None
        finding_title = finding.title
        assert finding_title is not None
        assert len(finding_title) > 0


@pytest.mark.asyncio
async def test_kcl_execute_code_and_export_with_bad_units():
    bad_units_file = os.path.join(tests_dir, "bad_units_in_annotation", "input.kcl")
    # Read from a file.
    with open(bad_units_file, "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0
        try:
            await kcl.execute_code_and_export(code, kcl.FileExportFormat.Step)
        except Exception as e:
            assert e is not None
            assert len(str(e)) > 0
            print(e)
            assert "[1:1]" in str(e)
