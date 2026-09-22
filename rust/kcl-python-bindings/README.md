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

To correlate a KCL call with Zoo backend logs, provide an API call ID when
creating the session. Generate the ID before the call so it remains available
if connecting or executing fails. The same ID covers subsequent measurements,
snapshots, and exports on that session:

```python
from uuid import uuid4

api_call_id = str(uuid4())
async with await kcl.new_kcl_session_code(code, api_call_id=api_call_id) as session:
    properties = await session.measure(request)
```

`session.outcome` is an `ExecOutcome` with the same diagnostics, constraint reports,
and sketch rendering methods returned by `execute()`. Accessing it shares the
saved result without copying the execution state or running KCL again. Use
`outcome.report(issue)` to render an individual diagnostic, and
`outcome.render_sketch_png(name, instance_index=...)` to select duplicate sketch
names using the constraint report's instance index.

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
