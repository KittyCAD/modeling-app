use pyo3_stub_gen::Result;

fn main() -> Result<()> {
    // `stub_info` is a function defined by `define_stub_info_gatherer!` macro.
    let stub = kcl::stub_info()?;
    stub.generate()?;

    // Append exception stubs which we maintain manually.
    // `pyo3_stub_gen` can't auto-generate `PanicException` because it comes
    // from pyo3 itself, and it can't auto-generate `KclError` because our
    // `PyException` subclass path does not compile on PyPy.
    let stub_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("zoo_kcl.pyi");
    let mut contents = std::fs::read_to_string(&stub_path)?;
    contents.push_str(
        "\nclass KclError(builtins.Exception):\n    def __new__(cls, _message: typing.Any, retryable: builtins.bool = False) -> KclError: ...\n    def is_retryable(self) -> builtins.bool: ...\n\nclass PanicException(BaseException):\n    r\"\"\"\n    The exception raised when Rust code called from Python panics.\n\n    Like SystemExit, this exception is derived from BaseException so that\n    it will typically propagate all the way through the stack and cause the\n    Python interpreter to exit.\n    \"\"\"\n    ...\n",
    );
    std::fs::write(&stub_path, contents)?;

    Ok(())
}
