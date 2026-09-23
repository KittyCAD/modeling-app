# kcl-python-bindings

Python bindings to the rust kcl-lib crate.

## Usage

The [tests.py](tests/tests.py) file contains examples of how to use the library.

Execute KCL once, then reuse the session for snapshots, exports, measurements,
and sketch constraint reports:

```python
async with await kcl.new_kcl_session("main.kcl") as session:
    images = await session.snapshots(kcl.ImageFormat.Png, [])
    files = await session.export(kcl.FileExportFormat.Step)
    request = kcl.PhysicalPropertiesRequest()
    request.set_volume(kcl.UnitVolume.CubicMillimeters)
    properties = await session.measure(request)
    constraints = await session.sketch_constraint_report()
    outcome = session.outcome

# These saved results also work after the session closes.
issues = outcome.issues()
messages = outcome.report_all()
# Render a sketch by its name from the constraint report:
# png = bytes(outcome.render_sketch_png("profile"))
```

Use `new_kcl_session_code(code)` for a source string. The context manager closes
the connection on exit, including when the body raises an exception. When managing
the session yourself, call `await session.close()` when finished.

`session.outcome` is an `ExecOutcome` with the same diagnostics, constraint reports,
and sketch rendering methods returned by `execute()`. Accessing it shares the
saved result without copying the execution state or running KCL again. Use
`outcome.report(issue)` to render an individual diagnostic, and
`outcome.render_sketch_png(name, instance_index=...)` to select duplicate sketch
names using the constraint report's instance index.

### Inspecting sketches after an execution error

Execution still raises `KclError` by default. Inspection callers can opt into
`allow_partial=True` to receive a session even when execution fails later:

```python
async with await kcl.new_kcl_session("main.kcl", allow_partial=True) as session:
    # Keep reporting the original failure; a PNG is not project validation.
    if session.execution_error is not None:
        print(session.execution_error)
    png = bytes(session.render_sketch_png("profile"))
```

`session.render_sketch_png` uses the saved result for both successful and failed
executions. An inspection-only session has already closed its Engine connection.
Its `outcome`, snapshots, exports and measurements raise the original execution
error; it does not present partial geometry as a successful model.

Use `await session.sketch_constraint_report()` when a report is needed. On failure,
the report remains explicitly incomplete and includes the original error. PNG
rendering does not request another report. Existing exception-based callers can
still use `KclError.render_sketch_png` and its `sketch_constraint_report` property.
For duplicate names, pass `instance_index` from a fresh constraint report for
the same entrypoint and source. Refresh indices after editing the project.
Rendering also works after `session.close()`. It uses the saved scene and neither
re-executes nor changes/copies project files, including imported assets.

Parse errors still raise, even with `allow_partial=True`, because they have no
execution output. Missing, unfinished, and empty sketches
cannot be recovered; `render_sketch_png` raises an exception in these cases.
A sketch whose constraints conflict can still render with its existing diagnostic
colours; the PNG does not establish that those constraints are satisfied.

This is recovery, not execution optimization: later operations still run until
the failure. Rendering is synchronous, like `ExecOutcome.render_sketch_png`;
this API does not add a timeout or promise preemptive cancellation of rendering.

## Development

We use [maturin](https://github.com/PyO3/maturin) for this project.

You can either download binaries from the [latest release](https://github.com/PyO3/maturin/releases/latest) or install it with [pipx](https://pypa.github.io/pipx/):

```shell
pipx install maturin
```

> [!NOTE]
>
> `pip install maturin` should also work if you don't want to use pipx.

There are four main commands:

- `maturin publish` builds the crate into python packages and publishes them to pypi.
- `maturin build` builds the wheels and stores them in a folder (`target/wheels` by default), but doesn't upload them. It's possible to upload those with [twine](https://github.com/pypa/twine) or `maturin upload`.
- `maturin develop` builds the crate and installs it as a python module directly in the current virtualenv. Note that while `maturin develop` is faster, it doesn't support all the feature that running `pip install` after `maturin build` supports.

`pyo3` bindings are automatically detected. 
`maturin` doesn't need extra configuration files and doesn't clash with an existing setuptools-rust or milksnake configuration.

### How to run tests

Starting from scratch to run a single test

```shell
export ZOO_API_TOKEN=<Token from zoo.dev aka production token>
cd modeling-app/rust/kcl-python-bindings
uv venv
just dev-install
uv run pytest tests/tests.py -k "tests and test_import_and_snapshots_single"
```

If you do not use a `ZOO_API_TOKEN` from the production environment of `zoo.dev` it will not work.

### Releasing a new version

1. Make sure the `Cargo.toml` has the new version you want to release.
2. Run `make tag` this is just an easy command for making a tag formatted
   correctly with the version.
3. Push the tag (the result of `make tag` gives instructions for this)
4. Everything else is triggered from the tag push. Just make sure all the tests
   pass on the `main` branch before making and pushing a new tag.
