# KCL

This contains the KCL standard library, executor and test suite.

For using it, see [the API docs](https://docs.rs/kcl-lib).

For developing it, see [CONTRIBUTING.md](contributing.md)

## Parse-only CLI

`kcl-parse` is for internal use only for now.

Build `kcl-parse` from the `rust/` directory:

```sh
cargo build --locked -p kcl-lib --bin kcl-parse > /tmp/kcl-parse-build.log 2>&1
```

Parse one file:

```sh
./target/debug/kcl-parse program.kcl > verdict.txt 2> diagnostics.txt
```

Read source from standard input:

```sh
./target/debug/kcl-parse - < program.kcl > verdict.txt 2> diagnostics.txt
```

Omitting `FILE` also reads from standard input. Input must be UTF-8.

- Accepted source prints `accept` on stdout and exits with status `0`.
- Rejected source prints `reject` on stdout and exits with status `0`. The first
  parser error is reported on stderr with source context.
- Invocation failures exit with status `2`.
- Input/output failures exit with status `2`.
- Internal parser errors exit with status `2`.

Tool failures report a diagnostic on stderr. They do not produce a source
acceptance verdict. A failed write to stdout can leave a partial verdict.

The CLI calls `Program::parse_no_errs` using the original source.

- Warnings do not cause rejection.
- Parser version handling is unchanged.
- Imported files are not loaded.
- Programs are not executed.

- `--help` prints usage and exits with status `0`.
- `--version` prints the binary version and exits with status `0`.
