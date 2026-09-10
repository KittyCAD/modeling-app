"""Instance selection uses real KCL execution and solver output."""

from pathlib import Path

import kcl
import pytest


@pytest.mark.asyncio
async def test_duplicate_sketch_instances() -> None:
    fixture = (
        Path(__file__).parents[2]
        / "kcl-lib/tests/sketch_visualizer/duplicate_names/input.kcl"
    )
    outcome = await kcl.mock_execute(str(fixture))
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
