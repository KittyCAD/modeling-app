# KCL Syntax

Crate for the lossless KCL lexer and future parser.


## Invariants

1. kcl-syntax crate does **not** depend on another kcl- crate. It is a leaf
   dependency.
1. Lossless means **all** cases get a `SyntaxKind`. Erroneous cases as well!
1. Semantic decisions are not a Lexer's job.
1. Lexer adds correct coordinates for each element.

## Current Status

- Logos implementation defines tokens and returns `LexedSource`.
- `kcl-lib` depends on `kcl-syntax`.
- For a lossless lexer and to prepare for a lossless parser:
    * New tokens capture incomplete or erroneous input, for example
      `UnterminatedString` and `UnterminatedBlockComment`.
    * Open/close delimiters have separate tokens.
    * Keywords get their own tokens. This will help with lossless parsing.
    * `import` is always a keyword. The parser will disambiguate keyword use
      from user function.
    * Escaped newline in a string, such as `"a\\\n"`, follows string recovery
      and stops at the line boundary.
    * Unsupported Unicode scalars become `Unknown`.
- Added a manual Big List of Naughty Strings (BLNS) robustness runner to check
  that lexer input preserves text, does not panic, and does not hang. See
  [README](../manual/blns-lexer-tests/README.md) and the accompanying justfile.

## Design

A lossless lexer and parser for KCL that can be used for both the LSP and the
evaluator.

At a high level the main data structure is an immutable tree (Concrete Syntax
Tree or CST) that will hold all information from the KCL text: comments,
whitespace, code, and erroneous input. The CST will then provide further typed
AST wrapper APIs for access and manipulation, such as an AST for the evaluator
and a syntax tree for text query and manipulation.

The high-level architecture and tooling are inspired by projects such as
rust-analyzer and Roslyn.
