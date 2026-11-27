# KCL Grammar Recognizer

This crate is intended to provide:

- A KCL grammar written in LALRPOP, used to generate a reference recognizer.
- A corpus of `.kcl` files classified by expected membership in that grammar.

## Recognizer

The recognizer determines whether an entire input belongs to the language defined
by the grammar.

The recognizer checks syntactic membership only. It does not prescribe a tree
representation for other KCL implementations. The grammar is intended to be easy
to read and reuse.

## Corpus

The corpus is intended to provide a large, shared set of KCL membership tests.
It is not exhaustive.

Its goals are:

- Increase confidence that the grammar specification describes the intended KCL
  syntax.
- Increase confidence that the reference recognizer implements that specification.
- Give other implementations of the KCL grammar a shared "golden set" for checking
  syntactic compatibility.

An implementation passes the corpus when it produces the expected membership
result for every test file. This establishes agreement on the tested inputs; it
does not prove conformance to the grammar for all possible inputs.

### Fixture selection

Choose small examples that each check a distinct behavior:

- A grammar production alternative.
- A boundary involving optional syntax.
- A boundary involving repetition.
- An interaction between grammar rules.
- A lexical variation.
- A regression for a known defect.

Cover lexical variations across the corpus without repeating each variation under
every grammar construct. Add combinations when they test a distinct interaction.

Each failure fixture should contain one intended syntax violation. Use descriptive
filenames to identify what each fixture checks.

## Corpus driver

Give the parser executable and its arguments after `--`. Run this example
from the `rust/` directory with `kcl-parse` on `PATH`.

```sh
cargo run --locked -p kcl-grammar --bin kcl-grammar-driver -- \
  --corpus kcl-grammar/corpus -- kcl-parse - \
  > /tmp/kcl-grammar-driver-report.txt 2> /tmp/kcl-grammar-driver-diagnostics.txt
```

The driver supplies each `.kcl` file to the parser on stdin. The parser should
exit with status `0` and write a single `accept` or `reject` verdict to stdout.
In the text report, parser diagnostics go to stderr. The driver prints each
fixture's expected verdict, actual verdict, and outcome in corpus-relative path
order, followed by totals. The fixture's top-level directory determines the
expected verdict.

- `success/` expects `accept`.
- `failures/` expects `reject`.

- `--skip-file FILE` applies gitignore-style patterns relative to the corpus root.
- `--failed-files FILE` writes one corpus-relative path per line for each failed
  fixture, including failures caused by tool errors.
- `--json` writes the report as a single JSON object to stdout. Redirect stdout
  to save the report to a file.

Completed runs emit the JSON report even when the exit status is nonzero.

- `summary` counts the fixtures by outcome.
- `results` lists fixtures in corpus-relative path order.

Each result has four required fields.

- `path` is relative to the corpus root.
- `expected` is the verdict assigned by the corpus.
- `actual` is the parser's verdict, or `null` when there is no verdict.
- `outcome` is one of these values.
  - `success` means the parser returned the expected verdict.
  - `fail` means the parser returned an unexpected verdict or there was a tool error.
  - `skipped` means a skip pattern excluded the fixture.

Additional fields appear when applicable.

- `error` describes a tool or protocol error.
- `stderr` contains any diagnostics emitted by the parser.
- `reproduce` appears on failed results. Paste it into Bash or Zsh with the same
  parser environment to rerun the case. The command uses the original working
  directory, parser arguments, and fixture as stdin.

The exit status describes the run result.

- `0` if every selected fixture produced the expected verdict.
- `1` if at least one verdict differed from its expectation and no tool error occurred.
- `2` if an invocation, I/O, or parser protocol error occurred.

## Development

Run these commands from this directory:

- `just build` : generates and builds the recognizer
- `just test`  : runs tests against generated recognizer
