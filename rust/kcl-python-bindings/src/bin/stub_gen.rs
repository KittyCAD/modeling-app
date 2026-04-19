use pyo3_stub_gen::Result;

fn main() -> Result<()> {
    // `stub_info` is a function defined by `define_stub_info_gatherer!` macro.
    let stub = kcl::stub_info()?;
    stub.generate()?;

    // Append PanicException to the generated stub file.
    // pyo3_stub_gen can't auto-generate this because PanicException comes from
    // pyo3 itself, not from our code annotated with gen_stub_pyclass.
    let stub_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("zoo_kcl.pyi");
    let mut contents = std::fs::read_to_string(&stub_path)?;
    contents.push_str(
        "\nclass PanicException(BaseException):\n    r\"\"\"\n    The exception raised when Rust code called from Python panics.\n\n    Like SystemExit, this exception is derived from BaseException so that\n    it will typically propagate all the way through the stack and cause the\n    Python interpreter to exit.\n    \"\"\"\n    ...\n",
    );
    std::fs::write(&stub_path, contents)?;

    Ok(())
}
