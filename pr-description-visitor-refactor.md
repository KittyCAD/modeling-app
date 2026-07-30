## What

This adds a proper mutable AST visitor for KCL and starts moving rename-related traversal over to shared visitor code.

The main bit is `walk_mut`, which lets mutation code walk the AST without each feature needing to re-list every expression type by hand.

This PR uses that for the rename paths that are a clean fit:

- renaming declarations with a matching name
- renaming sketch member references like `s.line1`
- finding rename targets with a small immutable query visitor

The read-side `rename_target_at` path was also getting a bit chunky, especially because both `Expr` and `BinaryPart` had their own recursive versions of basically the same walk. That is now centralized through a small visitor instead.

## Why

The sketch-block rename fix made it pretty obvious that this code wanted a shared AST traversal layer.

Before this, adding a rename behaviour meant remembering to thread it through arrays, calls, binary expressions, objects, sketch blocks, function bodies, and so on. That is easy to get subtly wrong, and it was already making the rename code longer than the actual rename logic.

The visitor gives us a better place to put traversal mechanics, so the rename code can stay focused on what it is trying to change.

## What This Refactors

- Adds `ast_visit_mut.rs` for mutable AST walking.
- Exposes `VisitMut`, `walk_mut`, and `walk_block_mut` from `walk`.
- Refactors declaration rename traversal to use the mutable visitor.
- Refactors sketch member reference rename traversal to use the mutable visitor.
- Adds a small immutable query visitor for finding the rename target at a cursor position.
- Removes duplicated `rename_target_at` traversal from `Expr` and `BinaryPart`.

## What This Does Not Refactor

This does not move all rename logic to visitors.

In particular, `rename_identifiers` stays on the existing scoped recursion for now. That path has real shadowing behaviour around function params, tag bindings, and local declarations. The current mutable visitor is intentionally simple, and it does not yet have scope enter/exit hooks or a “skip this subtree but continue walking elsewhere” result.

Trying to force that into this PR would make the visitor abstraction muddier, and it would make the rename behaviour riskier to review.

This also does not touch hover, semantic tokens, completions, execution, or the broader LSP query paths. Some of those already use the existing immutable walk, and others carry extra context where a generic visitor refactor would want its own careful pass.

## Tests

Ran:

- `cargo +nightly fmt --check`
- `cargo test -p kcl-lib test_rename_sketch_block --lib`
- `cargo test -p kcl-lib rename --lib`
- `cargo test -p kcl-lib simulation_tests::tangent_circle_circle::kcl_test_execute --lib`
- `cargo clippy -p kcl-lib --lib --tests -- -D warnings`
