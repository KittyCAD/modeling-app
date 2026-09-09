# kcl-python-bindings

Python bindings to the rust kcl-lib crate.

## Usage

The [tests.py](tests/tests.py) file contains examples of how to use the library.

Engine-backed functions accept a keyword-only `trace=None` argument to collect
Zoo backend API call IDs without changing their return values or exceptions:

```python
import kcl

trace = kcl.ApiCallTrace()
try:
    result = await kcl.execute_code("x = 1", trace=trace)
finally:
    print(trace.api_call_ids)
```

`api_call_ids` is a read-only property returning a new list of distinct IDs in
observation order. The collector uses shared Rust storage, so IDs observed in
background tasks survive execution errors, measurement/export failures, and
cancellation. It records handshake headers (`X-Api-Call-Id`, falling back to
`x-request-id`) and modeling session metadata without waiting for extra frames.
Rejected HTTP handshakes retain available header IDs. Mock execution and failures
before contacting Zoo leave the list empty.

The option is supported by execution, measurements, bounding boxes, exports,
snapshots (including imports and multiple views), and sketch constraint reports,
for both code and path variants. A trace can be reused to accumulate IDs; use a
fresh trace per attempt to correlate retries. It contains backend connection IDs,
not per-command IDs.

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

### Releasing a new version

1. Make sure the `Cargo.toml` has the new version you want to release.
2. Run `make tag` this is just an easy command for making a tag formatted
   correctly with the version.
3. Push the tag (the result of `make tag` gives instructions for this)
4. Everything else is triggered from the tag push. Just make sure all the tests
   pass on the `main` branch before making and pushing a new tag.
