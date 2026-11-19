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

## Development

Run these commands from this directory:

- `just build` : generates and builds the recognizer
- `just test`  : runs tests against generated recognizer
