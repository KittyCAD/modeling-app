#!/usr/bin/env python3
import asyncio
import os
import sys

import kcl
import pytest
from kcl import Point3d

# Get the path to this script's parent directory.
files_dir = os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "files")
kcl_dir = os.path.join(
    os.path.dirname(os.path.realpath(__file__)), "..", "..", "kcl-lib"
)
tests_dir = os.path.join(kcl_dir, "tests")
lego_file = os.path.join(kcl_dir, "e2e", "executor", "inputs", "lego.kcl")

engine_error_file = os.path.join(tests_dir, "error_large_fillet_radius", "input.kcl")
cube_step_file = os.path.join(
    os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "files", "cube.step"
)
axial_fan = os.path.join(
    os.path.dirname(os.path.realpath(__file__)),
    "..",
    "..",
    "..",
    "public",
    "kcl-samples",
    "axial-fan",
)

box_code = """
box_width = 25
box_depth = 25
box_height = 50

box_sketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> xLine(length = box_width)
  |> yLine(length = box_depth)
  |> xLine(endAbsolute = profileStartX(%))
  |> close()

box3D = extrude(box_sketch, length = box_height)
"""

requires_engine = pytest.mark.skipif(
    "ZOO_API_TOKEN" not in os.environ, reason="requires ZOO_API_TOKEN"
)

MAX_EXECUTION_ATTEMPTS = 3
EXECUTION_RETRY_BASE_DELAY_SECONDS = 1


async def execute_with_retries(async_fn, *args, **kwargs):
    retries_remaining = MAX_EXECUTION_ATTEMPTS - 1
    attempt = 1
    while True:
        try:
            return await async_fn(*args, **kwargs)
        except Exception as error:
            is_retryable = getattr(error, "is_retryable", None)
            if retries_remaining > 0 and callable(is_retryable) and is_retryable():
                delay_seconds = EXECUTION_RETRY_BASE_DELAY_SECONDS * 2 ** (attempt - 1)
                print(
                    f"Execute attempt {attempt}/{MAX_EXECUTION_ATTEMPTS} got "
                    f"retryable {type(error).__name__}: {error}; retrying in "
                    f"{delay_seconds}s...",
                    file=sys.stderr,
                )
                await asyncio.sleep(delay_seconds)
                retries_remaining -= 1
                attempt += 1
                continue
            raise


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_with_exception():
    # Read from a file.
    try:
        await execute_with_retries(
            kcl.execute, os.path.join(files_dir, "parse_file_error")
        )
    except Exception as e:
        assert e is not None
        assert len(str(e)) > 0
        assert "lksjndflsskjfnak;jfna##" in str(e)


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute():
    # Read from a file.
    await execute_with_retries(kcl.execute, lego_file)


@pytest.mark.asyncio
@pytest.mark.parametrize("from_file", [False, True])
async def test_kcl_session_context_manager(tmp_path, from_file):
    code = "@settings(kclVersion = 2.0)\nvalue = 1"
    if from_file:
        source = tmp_path / "main.kcl"
        source.write_text(code)
        session = await kcl.new_kcl_session(str(source), mock=True)
    else:
        session = await kcl.new_kcl_session_code(code, mock=True)

    async with session as entered:
        assert entered is session
        assert isinstance(session.outcome, kcl.ExecOutcome)
        assert session.outcome.issues() == []
        report = await session.sketch_constraint_report()
        assert report.total_sketches() == 0
        assert report.is_complete is True

    # Context exit closes the session, and repeated close is harmless.
    await session.close()
    assert session.outcome.report_all() == []
    with pytest.raises(Exception, match="Connection already closed"):
        async with session:
            pytest.fail("A closed session must not be entered")
    with pytest.raises(Exception, match="Connection already closed"):
        await session.measure(kcl.PhysicalPropertiesRequest())
    with pytest.raises(Exception, match="Connection already closed"):
        await session.snapshots(kcl.ImageFormat.Png, [])
    with pytest.raises(Exception, match="Connection already closed"):
        await session.export(kcl.FileExportFormat.Step)
    with pytest.raises(Exception, match="Connection already closed"):
        await session.sketch_constraint_report()


@pytest.mark.asyncio
async def test_kcl_session_context_manager_propagates_exception():
    session = await kcl.new_kcl_session_code(
        "@settings(kclVersion = 2.0)\nvalue = 1", mock=True
    )
    error = ValueError("context body failed")
    with pytest.raises(ValueError) as raised:
        async with session:
            raise error
    assert raised.value is error
    with pytest.raises(Exception, match="Connection already closed"):
        await session.export(kcl.FileExportFormat.Step)


@pytest.mark.asyncio
async def test_kcl_session_explicit_close():
    session = await kcl.new_kcl_session_code(
        "@settings(kclVersion = 2.0)\nvalue = 1", mock=True
    )
    await session.close()
    await session.close()
    with pytest.raises(Exception, match="Connection already closed"):
        await session.measure(kcl.PhysicalPropertiesRequest())


@requires_engine
@pytest.mark.asyncio
async def test_kcl_session_reuses_execution_for_tools(tmp_path):
    source = tmp_path / "main.kcl"
    source.write_text("""
@settings(kclVersion = 2.0)
profile = sketch(on = XY) {
  circle001 = circle(center = [var 0mm, var 0mm], start = [var 5mm, var 0mm])
}
disk = region(point = [0mm, 0mm], sketch = profile)
solid = extrude(disk, length = 10mm)
""")
    async with await execute_with_retries(
        kcl.new_kcl_session, str(source), highlight_edges=False
    ) as session:
        # All four tools use the executed model after its source is removed.
        source.unlink()
        report = await session.sketch_constraint_report()
        assert report.total_sketches() == 1
        assert report.under_constrained[0].name == "profile"
        assert session.outcome.sketch_constraint_report().total_sketches() == 1
        images = await session.snapshots(kcl.ImageFormat.Png, [])
        assert len(images) == 1
        assert bytes(images[0]).startswith(b"\x89PNG\r\n\x1a\n")

        files = await session.export(kcl.FileExportFormat.Step)
        assert files
        assert b"ISO-10303-21" in bytes(files[0].contents)

        request = kcl.PhysicalPropertiesRequest()
        request.set_volume(kcl.UnitVolume.CubicMillimeters)
        response = await session.measure(request)
        # Allow the engine's approximation of the circular cross-section.
        assert response.get_volume() == pytest.approx(785.398163, rel=0.002)
        assert response.get_volume_unit() == kcl.UnitVolume.CubicMillimeters
        # Reporting neither consumes the saved state nor closes the connection.
        assert (await session.sketch_constraint_report()).total_sketches() == 1


@pytest.mark.asyncio
async def test_kcl_session_sketch_constraint_report(tmp_path):
    source = tmp_path / "main.kcl"
    source.write_text("""
@settings(kclVersion = 2.0, experimentalFeatures = allow)
fixedSketch = sketch(on = XY) {
  edge = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge.start.at[0] == 0mm
  edge.start.at[1] == 0mm
  edge.end.at[0] == 10mm
  edge.end.at[1] == 0mm
}
freeSketch = sketch(on = XY) {
  edge = line(start = [var 0mm, var 0mm], end = [var 0mm, var 10mm])
}
""")
    async with await kcl.new_kcl_session(str(source), mock=True) as session:
        source.unlink()
        for _ in range(2):
            report = await session.sketch_constraint_report()
            assert report.total_sketches() == 2
            assert report.is_complete is True
            assert report.kcl_error is None
            assert report.errors == []
            assert report.over_constrained == []
            assert report.warnings == []
            assert report.execution_errors == []
            assert report.execution_fatals == []
            (fixed,) = report.fully_constrained
            assert fixed.name == "fixedSketch"
            assert fixed.status == kcl.ConstraintKind.FullyConstrained
            assert fixed.free_count == 0
            (free,) = report.under_constrained
            assert free.name == "freeSketch"
            assert free.status == kcl.ConstraintKind.UnderConstrained
            assert free.free_count > 0

        outcome = session.outcome
        png = bytes(outcome.render_sketch_png("fixedSketch"))
        assert png.startswith(b"\x89PNG\r\n\x1a\n")

    # Local results remain usable after the connection and source are gone.
    assert session.outcome.sketch_constraint_report().total_sketches() == 2
    del session
    assert outcome.sketch_constraint_report().total_sketches() == 2
    assert bytes(outcome.render_sketch_png("fixedSketch")) == png


@pytest.mark.asyncio
async def test_kcl_session_sketch_constraint_report_preserves_warnings():
    async with await kcl.new_kcl_session_code(
        warning_sketch_code, mock=True
    ) as session:
        report = await session.sketch_constraint_report()
        assert report.total_sketches() == 1
        assert report.warnings
        assert any("angle" in warning for warning in report.warnings)
        assert report.is_complete is True
        outcome = session.outcome

    issues = outcome.issues()
    warnings = [outcome.report(issue) for issue in issues if issue.is_warning()]
    assert warnings == report.warnings
    assert outcome.report_all() == [outcome.report(issue) for issue in issues]
    assert session.outcome.report_all() == outcome.report_all()


@pytest.mark.asyncio
async def test_kcl_parse_with_exception():
    # Read from a file.
    try:
        await kcl.parse(os.path.join(files_dir, "parse_file_error"))
    except Exception as e:
        assert e is not None
        assert len(str(e)) > 0
        assert "lksjndflsskjfnak;jfna##" in str(e)


@pytest.mark.asyncio
async def test_kcl_parse():
    # Read from a file.
    result = await kcl.parse(lego_file)
    assert result is True


def test_kcl_error_is_retryable():
    assert kcl.KclError("retry me", True).is_retryable() is True
    assert kcl.KclError("do not retry").is_retryable() is False
    assert kcl.KclError("do not retry").sketch_constraint_report is None


@pytest.mark.asyncio
async def test_execute_with_retries_uses_backoff_for_retryable_errors(
    monkeypatch, capsys
):
    attempts = 0
    observed_delays = []

    class RetryableTestError(Exception):
        def is_retryable(self):
            return True

    async def fail_twice_then_succeed():
        nonlocal attempts
        attempts += 1
        if attempts < MAX_EXECUTION_ATTEMPTS:
            raise RetryableTestError("temporary engine failure")
        return "success"

    async def record_sleep(delay_seconds):
        observed_delays.append(delay_seconds)

    monkeypatch.setattr(asyncio, "sleep", record_sleep)

    assert await execute_with_retries(fail_twice_then_succeed) == "success"
    assert attempts == MAX_EXECUTION_ATTEMPTS
    assert observed_delays == [1, 2]
    assert "attempt 1/3" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_execute_with_retries_does_not_retry_other_errors(monkeypatch):
    attempts = 0

    async def fail():
        nonlocal attempts
        attempts += 1
        raise ValueError("deterministic failure")

    async def unexpected_sleep(_delay_seconds):
        pytest.fail("a non-retryable failure must not back off")

    monkeypatch.setattr(asyncio, "sleep", unexpected_sleep)

    with pytest.raises(ValueError, match="deterministic failure"):
        await execute_with_retries(fail)
    assert attempts == 1


@pytest.mark.asyncio
async def test_kcl_default_units(tmp_path):
    kcl_file = tmp_path / "default-units.kcl"
    kcl_file.write_text(
        """@settings(defaultLengthUnit = in, defaultAngleUnit = rad)

startSketchOn(XY)
"""
    )

    units = await kcl.default_units(str(kcl_file))
    assert units.length == kcl.UnitLength.Inches
    assert units.angle == kcl.UnitAngle.Radians


@pytest.mark.asyncio
async def test_kcl_default_units_fallback_default(tmp_path):
    kcl_file = tmp_path / "default-units.kcl"
    kcl_file.write_text("startSketchOn(XY)")

    units = await kcl.default_units(str(kcl_file))
    assert units.length == kcl.UnitLength.Millimeters
    assert units.angle == kcl.UnitAngle.Degrees


@pytest.mark.asyncio
async def test_kcl_parse_code():
    # Read from a file.
    with open(lego_file, "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0
        result = kcl.parse_code(code)
        assert result is True


@pytest.mark.asyncio
async def test_kcl_mock_execute_with_exception():
    # Read from a file.
    try:
        await kcl.mock_execute(os.path.join(files_dir, "parse_file_error"))
    except Exception as e:
        assert e is not None
        assert len(str(e)) > 0
        assert "lksjndflsskjfnak;jfna##" in str(e)


@pytest.mark.asyncio
async def test_kcl_mock_execute_with_warnings():
    # Read from a file.
    outcome = await kcl.mock_execute(
        os.path.join(files_dir, "experimentalfeatures.kcl")
    )

    # Check the outcome contained the expected issues
    issues = outcome.issues()
    assert len(issues) == 1
    issue = issues[0]
    assert (
        issue.message()
        == "Use of `conic` is experimental and may change or be removed."
    )


@pytest.mark.asyncio
async def test_kcl_mock_execute_with_engine_exception_should_pass():
    # Read from a file.
    outcome = await kcl.mock_execute(engine_error_file)
    assert outcome.issues() == []


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_with_engine_exception_should_fail():
    # Read from a file.
    try:
        await execute_with_retries(kcl.execute, engine_error_file)
    except Exception as e:
        assert e is not None
        assert len(str(e)) > 0
        assert "engine" in str(e)


@pytest.mark.asyncio
async def test_kcl_mock_execute():
    # Read from a file.
    outcome = await kcl.mock_execute(lego_file)
    assert outcome.issues() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("use_session", [False, True])
async def test_duplicate_sketch_instances(use_session) -> None:
    fixture = os.path.join(
        tests_dir, "sketch_visualizer", "duplicate_names", "input.kcl"
    )
    if use_session:
        async with await kcl.new_kcl_session(fixture, mock=True) as session:
            outcome = session.outcome
    else:
        outcome = await kcl.mock_execute(fixture)
    report = outcome.sketch_constraint_report()
    assert [s.instance_index for s in report.fully_constrained] == [0, 1]
    with pytest.raises(Exception, match="found 2 sketches named `profile`"):
        outcome.render_sketch_png("profile")
    images = [
        bytes(outcome.render_sketch_png("profile", instance_index=i)) for i in (0, 1)
    ]
    assert all(png.startswith(b"\x89PNG\r\n\x1a\n") for png in images)
    assert images[0] != images[1]
    with pytest.raises(Exception, match="out of range"):
        outcome.render_sketch_png("profile", instance_index=2)
    with pytest.raises(OverflowError):
        outcome.render_sketch_png("profile", instance_index=-1)


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_geometry_only(tmp_path):
    source = tmp_path / "main.kcl"
    source.write_text(box_code)
    outcome = await execute_with_retries(kcl.execute, str(source), geometry_only=True)
    assert outcome.issues() == []


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_dir_assembly():
    # Read from a file.
    await execute_with_retries(kcl.execute, axial_fan)


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_snapshot():
    # Read from a file.
    image_bytes = await execute_with_retries(
        kcl.execute_and_snapshot,
        lego_file,
        kcl.ImageFormat.Jpeg,
        zoom=False,
        highlight_edges=False,
    )
    assert image_bytes is not None
    assert len(image_bytes) > 0


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_snapshot_options():
    camera = kcl.CameraLookAt(
        # Test both constructors, with unnamed fields and named fields.
        up=Point3d(0, 0, 1),
        vantage=Point3d(x=0, y=-1, z=0),
        center=Point3d(x=0, y=0, z=0),
    )
    views = [
        # Specific camera perspective
        kcl.SnapshotOptions(camera=camera, padding=0.5),
        # Camera=None means isometric view.
        kcl.SnapshotOptions(camera=None, padding=0),
    ]
    # Read from a file.
    images = await execute_with_retries(
        kcl.execute_and_snapshot_views,
        lego_file,
        kcl.ImageFormat.Jpeg,
        views,
        highlight_edges=False,
    )
    assert images is not None
    assert len(images) == len(views)
    image_bytes = images[0]
    assert image_bytes is not None
    assert len(image_bytes) > 0


@requires_engine
@pytest.mark.asyncio
async def test_import_and_snapshots():
    camera = kcl.CameraLookAt(
        # Test both constructors, with unnamed fields and named fields.
        up=Point3d(0, 0, 1),
        vantage=Point3d(x=0, y=-1, z=0),
        center=Point3d(x=0, y=0, z=0),
    )
    views = [
        # Specific camera perspective
        kcl.SnapshotOptions(camera=camera, padding=0.5),
        # Camera=None means isometric view.
        kcl.SnapshotOptions(camera=None, padding=0),
    ]
    # Read from a file.
    step_options = kcl.StepImportOptions()
    input_format = kcl.InputFormat3d.Step(step_options)
    print(cube_step_file)
    images = await execute_with_retries(
        kcl.import_and_snapshot_views,
        [cube_step_file],
        input_format,
        kcl.ImageFormat.Jpeg,
        views,
        highlight_edges=False,
    )
    assert images is not None
    assert len(images) == len(views)
    for i, image_bytes in enumerate(images):
        assert image_bytes is not None
        assert len(image_bytes) > 0


@requires_engine
@pytest.mark.asyncio
async def test_import_and_snapshots_single():
    # Read from a file.
    step_options = kcl.StepImportOptions()
    input_format = kcl.InputFormat3d.Step(step_options)
    print("The cube_step_file is", cube_step_file)
    image_bytes = await execute_with_retries(
        kcl.import_and_snapshot,
        [cube_step_file],
        input_format,
        kcl.ImageFormat.Jpeg,
        highlight_edges=False,
    )
    assert image_bytes is not None
    assert len(image_bytes) > 0


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_snapshot_dir():
    # Read from a file.
    image_bytes = await execute_with_retries(
        kcl.execute_and_snapshot, axial_fan, kcl.ImageFormat.Jpeg
    )
    assert image_bytes is not None
    assert len(image_bytes) > 0


@requires_engine
@pytest.mark.asyncio
@pytest.mark.parametrize("entry_point", ["file", "session"])
async def test_kcl_measure_all_physical_properties(tmp_path, entry_point):
    request = kcl.PhysicalPropertiesRequest()
    request.set_volume(kcl.UnitVolume.CubicCentimeters)
    request.set_mass(kcl.UnitMass.Grams, 1000.0, kcl.UnitDensity.KilogramsPerCubicMeter)
    request.set_density(
        kcl.UnitDensity.KilogramsPerCubicMeter, 62.5, kcl.UnitMass.Grams
    )
    request.set_center_of_mass(kcl.UnitLength.Centimeters)
    request.set_surface_area(kcl.UnitArea.SquareCentimeters)
    request.set_bounding_box(kcl.UnitLength.Inches)

    if entry_point == "file":
        source = tmp_path / "main.kcl"
        source.write_text(box_code)
        response = await kcl.execute_and_measure(
            str(source), request, geometry_only=True
        )
    else:
        async with await kcl.new_kcl_session_code(
            box_code, highlight_edges=False
        ) as session:
            response = await session.measure(request)

    assert response.get_volume() == pytest.approx(31.25)
    assert response.get_volume_unit() == kcl.UnitVolume.CubicCentimeters
    assert response.get_mass() == pytest.approx(31.25)
    assert response.get_mass_unit() == kcl.UnitMass.Grams
    assert response.get_density() == pytest.approx(2000.0)
    assert response.get_density_unit() == kcl.UnitDensity.KilogramsPerCubicMeter
    assert response.get_surface_area() == pytest.approx(62.5)
    assert response.get_surface_area_unit() == kcl.UnitArea.SquareCentimeters
    center = response.get_center_of_mass()
    assert (center.x, center.y, center.z) == pytest.approx((1.25, 1.25, 2.5))
    assert response.get_center_of_mass_unit() == kcl.UnitLength.Centimeters
    bounds = response.get_bounding_box()
    center = bounds.get_center()
    dimensions = bounds.get_dimensions()
    assert (center.x, center.y, center.z) == pytest.approx(
        (12.5 / 25.4, 12.5 / 25.4, 25 / 25.4)
    )
    assert (dimensions.x, dimensions.y, dimensions.z) == pytest.approx(
        (25 / 25.4, 25 / 25.4, 50 / 25.4)
    )


@requires_engine
@pytest.mark.asyncio
async def test_kcl_measure_subset_keeps_unrequested_properties_unavailable():
    request = kcl.PhysicalPropertiesRequest()
    request.set_volume(kcl.UnitVolume.CubicCentimeters)
    request.set_center_of_mass(kcl.UnitLength.Centimeters)
    async with await kcl.new_kcl_session_code(
        box_code, highlight_edges=False
    ) as session:
        response = await session.measure(request)
        assert response.get_volume() == pytest.approx(31.25)
        assert response.get_center_of_mass().z == pytest.approx(2.5)
        for getter in [
            response.get_mass,
            response.get_density,
            response.get_surface_area,
            response.get_bounding_box,
        ]:
            with pytest.raises(Exception, match="was not requested"):
                getter()
        empty = await session.measure(kcl.PhysicalPropertiesRequest())
        with pytest.raises(Exception, match="Volume was not requested"):
            empty.get_volume()


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_measure_bounding_box_cm(tmp_path):
    request = kcl.PhysicalPropertiesRequest()
    request.set_bounding_box(kcl.UnitLength.Centimeters)
    source = tmp_path / "main.kcl"
    source.write_text(box_code)
    response = await execute_with_retries(kcl.execute_and_measure, str(source), request)
    assert response is not None

    bounding_box = response.get_bounding_box()
    center = bounding_box.get_center()
    dimensions = bounding_box.get_dimensions()

    assert center.x == pytest.approx(1.25, rel=0, abs=1e-5)
    assert center.y == pytest.approx(1.25, rel=0, abs=1e-5)
    assert center.z == pytest.approx(2.5, rel=0, abs=1e-5)

    assert dimensions.x == pytest.approx(2.5, rel=0, abs=1e-5)
    assert dimensions.y == pytest.approx(2.5, rel=0, abs=1e-5)
    assert dimensions.z == pytest.approx(5.0, rel=0, abs=1e-5)


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_measure_bounding_box_mm(tmp_path):
    request = kcl.PhysicalPropertiesRequest()
    request.set_bounding_box(kcl.UnitLength.Millimeters)
    source = tmp_path / "main.kcl"
    source.write_text(box_code)
    response = await execute_with_retries(kcl.execute_and_measure, str(source), request)
    assert response is not None

    bounding_box = response.get_bounding_box()
    center = bounding_box.get_center()
    dimensions = bounding_box.get_dimensions()

    assert center.x == pytest.approx(12.5, rel=0, abs=1e-5)
    assert center.y == pytest.approx(12.5, rel=0, abs=1e-5)
    assert center.z == pytest.approx(25, rel=0, abs=1e-5)

    assert dimensions.x == pytest.approx(25, rel=0, abs=1e-5)
    assert dimensions.y == pytest.approx(25, rel=0, abs=1e-5)
    assert dimensions.z == pytest.approx(50, rel=0, abs=1e-5)


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_bounding_box(tmp_path):
    source = tmp_path / "main.kcl"
    source.write_text(box_code)
    response = await execute_with_retries(kcl.execute_and_bounding_box, str(source))
    assert response is not None

    center = response.get_center()
    dimensions = response.get_dimensions()

    assert center.x == pytest.approx(12.5, rel=0, abs=1e-5)
    assert center.y == pytest.approx(12.5, rel=0, abs=1e-5)
    assert center.z == pytest.approx(25.0, rel=0, abs=1e-5)

    assert dimensions.x == pytest.approx(25.0, rel=0, abs=1e-5)
    assert dimensions.y == pytest.approx(25.0, rel=0, abs=1e-5)
    assert dimensions.z == pytest.approx(50.0, rel=0, abs=1e-5)


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_bounding_box_with_linter_errors():
    box_file = os.path.join(files_dir, "box_with_linter_errors.kcl")
    response = await execute_with_retries(kcl.execute_and_bounding_box, box_file, [])
    assert response is not None

    center = response.get_center()
    dimensions = response.get_dimensions()

    assert center.x == pytest.approx(12.5, rel=0, abs=1e-5)
    assert center.y == pytest.approx(12.5, rel=0, abs=1e-5)
    assert center.z == pytest.approx(25.0, rel=0, abs=1e-5)

    assert dimensions.x == pytest.approx(25.0, rel=0, abs=1e-5)
    assert dimensions.y == pytest.approx(25.0, rel=0, abs=1e-5)
    assert dimensions.z == pytest.approx(50.0, rel=0, abs=1e-5)


@requires_engine
@pytest.mark.asyncio
async def test_kcl_execute_and_export():
    # Read from a file.
    files = await execute_with_retries(
        kcl.execute_and_export, lego_file, kcl.FileExportFormat.Step
    )
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
    await kcl.format_dir(axial_fan)


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


def test_kcl_lint_fix():
    # Read from a file.
    # This file has several lint errors.
    with open(os.path.join(files_dir, "box_with_linter_errors.kcl"), "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0

        # There should be several lints.
        expected_lints = 4
        lints = kcl.lint(code)
        assert lints is not None
        assert len(lints) >= expected_lints

        # These lints are fixable, though.
        # So if we lint and fix, some should go away.
        after_fixing = kcl.lint_and_fix_all(code)
        assert after_fixing.unfixed_lints is not None
        assert len(after_fixing.unfixed_lints) < expected_lints
        assert after_fixing.new_code != code


def test_kcl_lint_fix_no_style():
    # Read from a file.
    # This file has several lint errors.
    with open(os.path.join(files_dir, "box_with_linter_errors.kcl"), "r") as f:
        code = str(f.read())
        assert code is not None
        assert len(code) > 0

        # There should be several lints.
        expected_lints = 4
        lints = kcl.lint(code)
        assert lints is not None
        assert len(lints) >= expected_lints

        # These lints are fixable, though.
        # So if we lint and fix, some should go away.
        after_fixing = kcl.lint_and_fix_families(
            code, [kcl.FindingFamily.Correctness, kcl.FindingFamily.Simplify]
        )
        assert after_fixing.new_code == code


@pytest.mark.asyncio
async def test_kcl_execute_and_export_with_bad_units():
    bad_units_file = os.path.join(tests_dir, "bad_units_in_annotation", "input.kcl")

    with pytest.raises(kcl.KclError) as raised:
        await kcl.execute_and_export(bad_units_file, kcl.FileExportFormat.Step)

    error = str(raised.value)
    assert "KCL Semantic error" in error
    assert "Unexpected value for length units: `nm`" in error
    assert "[1:1]" in error
    assert "@settings(defaultLengthUnit = nm)" in error


@pytest.mark.asyncio
async def test_bad_units_in_annotation_reports_source_before_execution():
    bad_units_file = os.path.join(tests_dir, "bad_units_in_annotation", "input.kcl")
    with open(bad_units_file, "r") as f:
        code = f.read()

    for execute in (
        lambda: kcl.mock_execute(bad_units_file),
        lambda: kcl.new_kcl_session_code(code, mock=True),
    ):
        with pytest.raises(kcl.KclError) as raised:
            await execute()
        assert "Unexpected value for length units: `nm`" in str(raised.value)
        assert "[1:1]" in str(raised.value)

    report = await kcl.get_sketch_constraint_status_code(code)
    assert report.is_complete is False
    assert report.kcl_error is not None
    assert report.kcl_error.phase == "parse"
    assert "Unexpected value for length units: `nm`" in report.kcl_error.text
    assert "[1:1]" in report.kcl_error.text


def test_relevant_file_extensions():
    exts = kcl.relevant_file_extensions()
    assert isinstance(exts, list)
    assert len(exts) > 0
    assert len(exts) > 5
    assert all(isinstance(x, str) and len(x) > 0 for x in exts)
    # kcl should always be included in the set
    assert "kcl" in exts


fully_constrained_sketch_code = """
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
  line1.start.at[0] == 2
  line1.start.at[1] == 8
  line1.end.at[0] == 5
  line1.end.at[1] == 7
}
"""

under_constrained_sketch_code = """
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = line(start = [var 1.32mm, var -1.93mm], end = [var 6.08mm, var 2.51mm])
}
"""

mixed_sketches_code = """
@settings(experimentalFeatures = allow)

s1 = sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
  line1.start.at[0] == 2
  line1.start.at[1] == 8
  line1.end.at[0] == 5
  line1.end.at[1] == 7
}

s2 = sketch(on = XZ) {
  line1 = line(start = [var 1mm, var 2mm], end = [var 3mm, var 4mm])
}
"""

named_sketches_all_statuses_code = """
@settings(experimentalFeatures = allow)

fixedSketch = sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
  line1.start.at[0] == 2
  line1.start.at[1] == 8
  line1.end.at[0] == 5
  line1.end.at[1] == 7
}

looseSketch = sketch(on = XZ) {
  line1 = line(start = [var 1mm, var 2mm], end = [var 3mm, var 4mm])
}

conflictSketch = sketch(on = XY) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
  line1.start.at[0] == 2
  line1.start.at[1] == 8
  line1.end.at[0] == 5
  line1.end.at[1] == 7
  distance([line1.start, line1.end]) == 100mm
}
"""

execution_error_after_sketch_code = """
@settings(experimentalFeatures = allow)

s1 = sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
  line1.start.at[0] == 2
  line1.start.at[1] == 8
  line1.end.at[0] == 5
  line1.end.at[1] == 7
}

extrude(missing_sketch, length = 5mm)
"""

parse_error_sketch_code = """
@settings(experimentalFeatures = allow)

s1 = sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
  line1.start.at[0] == 2
  line1.start.at[1] == 8
  line1.end.at[0] == 5
  line1.end.at[1] == 7
"""

warning_sketch_code = """
@settings(defaultLengthUnit = mm)

warningSketch = sketch(on = XY) {
  horizontalLine = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  verticalLine = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  coincident([horizontalLine.end, verticalLine.start])
  horizontal(horizontalLine)
  vertical(verticalLine)
  angle([horizontalLine, verticalLine]) == 90deg
}
"""

error_sketch_code = """
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

errorSketch = sketch(on = XY) {
  bottom = line(start = [var 0, var 0], end = [var 10, var 0])
  right = line(start = [var 10, var 0], end = [var 10, var 10])
  top = line(start = [var 10, var 10], end = [var 0, var 10])
  left = line(start = [var 0, var 10], end = [var 0, var 0])
}
errorRegion = region(point = [5, 5], sketch = errorSketch)
errorSolid = extrude(sketches = errorRegion, length = 10)
"""


@requires_engine
@pytest.mark.asyncio
async def test_sketch_constraint_status_fully_constrained():
    report = await execute_with_retries(
        kcl.get_sketch_constraint_status_code, fully_constrained_sketch_code
    )
    assert len(report.fully_constrained) == 1
    assert len(report.under_constrained) == 0
    assert len(report.over_constrained) == 0
    assert len(report.errors) == 0
    assert report.is_complete is True
    assert report.kcl_error is None
    assert report.fully_constrained[0].status == kcl.ConstraintKind.FullyConstrained
    assert report.total_sketches() == 1


@requires_engine
@pytest.mark.asyncio
async def test_sketch_constraint_status_under_constrained():
    report = await execute_with_retries(
        kcl.get_sketch_constraint_status_code, under_constrained_sketch_code
    )
    assert len(report.fully_constrained) == 0
    assert len(report.under_constrained) == 1
    assert len(report.over_constrained) == 0
    assert len(report.errors) == 0
    assert report.under_constrained[0].status == kcl.ConstraintKind.UnderConstrained
    assert report.under_constrained[0].free_count > 0


@requires_engine
@pytest.mark.asyncio
async def test_sketch_constraint_status_mixed():
    outcome = await execute_with_retries(kcl.execute_code, mixed_sketches_code)
    report = outcome.sketch_constraint_report()
    assert report.total_sketches() == 2
    assert len(report.fully_constrained) == 1
    assert len(report.under_constrained) == 1
    assert len(report.errors) == 0
    assert report.is_complete is True
    assert report.kcl_error is None
    assert report.fully_constrained[0].name == "s1"
    assert report.under_constrained[0].name == "s2"
    assert bytes(outcome.render_sketch_png("s1")).startswith(b"\x89PNG\r\n\x1a\n")
    assert bytes(outcome.render_sketch_png("s2")).startswith(b"\x89PNG\r\n\x1a\n")


@requires_engine
@pytest.mark.asyncio
async def test_sketch_constraint_status_reports_names():
    # One file holding a fully constrained, an under-constrained, and an
    # over-constrained sketch. Every entry carries the name of the variable its
    # sketch was assigned to, so a caller can say which sketch needs
    # correcting.
    report = await execute_with_retries(
        kcl.get_sketch_constraint_status_code, named_sketches_all_statuses_code
    )
    assert report.total_sketches() == 3
    assert len(report.errors) == 0
    assert len(report.fully_constrained) == 1
    assert len(report.under_constrained) == 1
    assert len(report.over_constrained) == 1
    assert report.fully_constrained[0].name == "fixedSketch"
    assert report.under_constrained[0].name == "looseSketch"
    assert report.over_constrained[0].name == "conflictSketch"


@requires_engine
@pytest.mark.asyncio
async def test_sketch_constraint_status_includes_execution_warnings():
    report = await execute_with_retries(
        kcl.get_sketch_constraint_status_code, warning_sketch_code
    )
    assert report.total_sketches() == 1
    assert len(report.fully_constrained) == 0
    assert len(report.under_constrained) == 1
    assert len(report.over_constrained) == 0
    assert len(report.errors) == 0
    assert len(report.warnings) == 1
    assert "Instead of constraining to 90deg" in report.warnings[0]
    assert "constraint to Perpendicular" in report.warnings[0]
    assert len(report.execution_errors) == 0
    assert len(report.execution_fatals) == 0
    assert report.is_complete is True
    assert report.kcl_error is None


@requires_engine
@pytest.mark.asyncio
async def test_sketch_constraint_status_includes_non_fatal_execution_errors():
    report = await execute_with_retries(
        kcl.get_sketch_constraint_status_code, error_sketch_code
    )
    assert report.total_sketches() == 1
    assert len(report.fully_constrained) == 0
    assert len(report.under_constrained) == 1
    assert len(report.over_constrained) == 0
    assert len(report.errors) == 0
    assert len(report.warnings) == 0
    assert len(report.execution_errors) == 1
    assert "expects an unlabeled first argument" in report.execution_errors[0]
    assert len(report.execution_fatals) == 0
    assert report.is_complete is True
    assert report.kcl_error is None


@pytest.mark.asyncio
async def test_sketch_constraint_status_parse_error_returns_report():
    report = await kcl.get_sketch_constraint_status_code(parse_error_sketch_code)
    assert report.total_sketches() == 0
    assert len(report.fully_constrained) == 0
    assert len(report.under_constrained) == 0
    assert len(report.over_constrained) == 0
    assert len(report.errors) == 0
    assert len(report.warnings) == 0
    assert len(report.execution_errors) == 0
    assert len(report.execution_fatals) == 0
    assert report.is_complete is False
    assert report.kcl_error is not None
    assert report.kcl_error.phase == "parse"
    assert "KCL Syntax error" in report.kcl_error.text
    assert "Unexpected token" in report.kcl_error.text


@requires_engine
@pytest.mark.asyncio
async def test_exec_outcome_report_renders_csg_no_overlap_warning():
    outcome = await execute_with_retries(
        kcl.execute, os.path.join(files_dir, "warning.kcl")
    )
    issues = outcome.issues()
    assert len(issues) >= 1
    warning = next((i for i in issues if i.is_warning()), None)
    assert warning is not None
    report = outcome.report(warning)
    assert isinstance(report, str)
    assert len(report) > 0
    assert "had no overlap" in report


@requires_engine
@pytest.mark.asyncio
async def test_sketch_constraint_status_execution_error_returns_partial_report():
    report = await execute_with_retries(
        kcl.get_sketch_constraint_status_code, execution_error_after_sketch_code
    )
    assert report.total_sketches() == 1
    assert len(report.fully_constrained) == 1
    assert len(report.under_constrained) == 0
    assert len(report.over_constrained) == 0
    assert len(report.errors) == 0
    assert report.is_complete is False
    assert report.kcl_error is not None
    assert report.kcl_error.phase == "execution"
    assert "missing_sketch" in report.kcl_error.text


@pytest.mark.asyncio
async def test_primary_execution_error_carries_partial_constraint_report():
    with pytest.raises(kcl.KclError) as raised:
        await kcl.new_kcl_session_code(execution_error_after_sketch_code, mock=True)

    report = raised.value.sketch_constraint_report
    assert report is not None
    assert report.total_sketches() == 1
    assert len(report.fully_constrained) == 1
    assert report.is_complete is False
    assert report.kcl_error is not None
    assert report.kcl_error.phase == "execution"
    assert "missing_sketch" in report.kcl_error.text
    assert "SketchConstraintReport" not in str(raised.value)
    assert raised.value.args == (report.kcl_error.text, False)
    assert raised.value.is_retryable() is False
    assert str(raised.value) == str(kcl.KclError(report.kcl_error.text, False))
