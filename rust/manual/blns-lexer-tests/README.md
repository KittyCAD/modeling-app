# BLNS Lexer Runner

Manual robustness checks for the KCL lexer using
https://github.com/minimaxir/big-list-of-naughty-strings.

This crate is intentionally outside the main Rust workspace. The normal CI
commands under `rust/` do not compile, lint, or run it.

Run with `just`:

```sh
just --justfile manual/blns-lexer-tests/justfile blns /path/to/blns.json
```

Or run through the environment:

```sh
KCL_BLNS_JSON=/path/to/blns.json \
  just --justfile manual/blns-lexer-tests/justfile blns-env
```

The runner spawns a worker process and kills it if the timeout expires. The
default timeout is 30 seconds.

```sh
just --justfile manual/blns-lexer-tests/justfile blns /path/to/blns.json 45s
```

The runner prints progress while it scans the corpus. To change the progress
frequency:

```sh
just --justfile manual/blns-lexer-tests/justfile blns /path/to/blns.json 30s 25
```

Direct cargo invocation also works:

```sh
cargo run --manifest-path manual/blns-lexer-tests/Cargo.toml -- /path/to/blns.json --timeout 30s
```
