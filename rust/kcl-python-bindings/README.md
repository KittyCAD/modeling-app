# kcl-python-bindings

Python bindings to the rust kcl-lib crate.

## Usage

The [tests.py](tests/tests.py) file contains examples of how to use the library.

### Inspecting sketches after an execution error

Execution still raises `KclError` when KCL fails. If a sketch completed before
that failure, the error retains its geometry and constraint colours:

```python
try:
    outcome = await kcl.execute("main.kcl")
except kcl.KclError as error:
    report = error.sketch_constraint_report()
    # Keep reporting the original failure; a PNG is not project validation.
    print(error)
    if report is not None:
        png = bytes(error.render_sketch_png("profile"))
```

For duplicate names, pass `instance_index` from **this error's** constraint
report. The report has `is_complete=False` and retains the original KCL error.
Rendering uses the saved scene after the engine connection closes. It neither
re-executes nor changes/copies project files, including imported assets.

Parse errors have no execution output (`sketch_constraint_report()` returns
`None`). Missing, unfinished, and empty sketches cannot be recovered. A sketch
whose constraints conflict can still render with its existing diagnostic colours;
the PNG does not establish that those constraints are satisfied.

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
