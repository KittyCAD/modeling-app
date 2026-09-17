# kcl-python-bindings

Python bindings to the rust kcl-lib crate.

## Usage

The [tests.py](tests/tests.py) file contains examples of how to use the library.

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

## Execute once, use the model repeatedly

`execute(path)` and `execute_code(code)` return a `Session`. Each call runs KCL
once. Keep the session open to take snapshots, export files, measure physical
properties, or query the bounding box of that model:

```python
async with await kcl.execute("main.kcl", highlight_edges=False) as session:
    outcome = session.outcome
    constraints = outcome.sketch_constraint_report()
    if outcome.error is not None:
        print(outcome.error.text)
    else:
        png = await session.snapshot(kcl.ImageFormat.Png)
        step_files = await session.export(kcl.FileExportFormat.Step)
        request = kcl.PhysicalPropertiesRequest()
        request.set_volume(kcl.UnitVolume.CubicMillimeters)
        properties = await session.measure(request)
        bounds = await session.bounding_box()
```

`await session.close()` is also supported. Closing is idempotent; engine methods
raise `RuntimeError` after closing. `outcome` and its reports remain usable.
Use `async with` to close on Python exceptions as well. Garbage collection only
provides best-effort cleanup; do not rely on it to release an idle engine.

Parse and execution failures are returned in `session.outcome.error`, with
`phase` and rendered `text`. `is_complete` is false and constraint reports retain
any sketches evaluated before failure. Parse failures create no engine
connection. File access and connection setup failures still raise exceptions.
Use `outcome.raise_for_error()` when your application requires complete execution.
Warnings and non-fatal compilation issues remain available through `issues()`.
`is_complete` describes whether execution aborted, not whether every sketch is
fully constrained or every diagnostic is a warning.

Engine methods operate on the current scene, including partial geometry after a
KCL failure. Check the outcome before treating exported geometry as a complete
model. Operations are serialized per session. Cancelling an engine operation
invalidates and closes its session, since the command may already be in flight.
Closing interrupts outstanding operations. There is no automatic reconnection
or re-execution; callers can explicitly retry when `outcome.is_retryable()` or a
raised `KclError.is_retryable()` indicates a transient failure. Close the previous
session before retrying. Snapshots retain their camera changes in the session.

### Migrating existing callers

The combined `execute[_code]_and_*` and `get_sketch_constraint_status[_code]`
functions have been removed. Replace them with one execution and the corresponding
`session.snapshot`, `snapshot_views`, `measure`, `bounding_box`, or `export` call.
Set `highlight_edges` on execution. Constraint reports and sketch PNG rendering
are methods on `session.outcome` and need no further engine calls.

Previous callers of `execute()` that only inspected an `ExecOutcome` must now
close the session and read `session.outcome`. `mock_execute[_code]` still returns
an `ExecOutcome` and raises on failure: it owns no live engine resources.
The CAD import snapshot helpers are unchanged.
