# KCL Syntax

Crate for the lossless KCL lexer and future parser.

## Current Status

Lexer first. Keep it compatible with the existing scanner (ES) used by the winnow implementation.

- Logos implementation defines tokens and returns `LexedSource`.
- `kcl-lib` depends on `kcl-syntax` only for running compatibility tests.
- For a lossless lexer and to prepare for a lossless parser:
    * New tokens capture incomplete or erroneous input, for example `UnterminatedString` and `UnterminatedBlockComment`.
    * Open/close delimiters have separate tokens. Compatibility tests map them to the same token in ES.
    * Keywords get their own tokens. Compatibility tests map them to the same `Keyword` token in ES. This will help with lossless parsing.
    * `Type` and `Function` tokens from ES are removed. These tokens are semantic classifications and can be reintroduced in a later semantic-token phase.
    * `import` is always a keyword. ES has special treatment for `import` because it can be used as a function name. The lexer should not have this logic; the parser will disambiguate.
    * Escaped newline in a string, such as `"a\\\n"`, follows string recovery and stops at the line boundary.
    * Unsupported Unicode scalars become `Unknown` instead of old-scanner lexical errors.
- Added a manual Big List of Naughty Strings (BLNS) robustness runner to check that lexer input preserves text, does not panic, and does not hang. See [README](../manual/blns-lexer-tests/README.md) and the accompanying justfile.

## Design

A lossless lexer and parser for KCL that can be used for both the LSP and the evaluator.

At a high level the main data structure is an immutable tree (Concrete Syntax Tree or CST) that will hold all information from the KCL text: comments, whitespace, code, and erroneous input. The CST will then provide further typed AST wrapper APIs for access and manipulation, such as an AST for the evaluator and a syntax tree for text query and manipulation.

The high-level architecture and tooling are inspired by projects such as rust-analyzer and Roslyn.
