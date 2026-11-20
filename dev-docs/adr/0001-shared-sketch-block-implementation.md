# Share one sketch-block implementation across KCL versions

Sketch blocks in every supported KCL version use the new Rust implementation and
one shared representation, exposed to TypeScript as one kind of sketch block.
The program's KCL version controls behavioral differences within that
implementation. TypeScript consumers may be updated for the shared
representation. This preserves historical sketch semantics without maintaining
separate legacy and generalized implementations, Rust structs, or TypeScript
variants.

Before changing the current sketch implementation or representation, add
regression tests that pin its observable behavior and establish a passing
baseline. Retain those tests through the refactor with explicit historical
cases: `1.0`, `2.0`, and `3.0`. Coverage includes name resolution, return and
unwind cleanup, call recognition and argument behavior, result bindings and
metadata, and sketch-specific restrictions. The baseline also covers the
contracts used by sketch editing: serialization and formatting round trips,
source lookup and path traversal, and editing state. Assertions should describe
observable behavior so the shared representation can change without retaining an
old AST shape.

Use simulation tests whenever possible, including for non-geometric results and
diagnostics. The baseline must explicitly cover the known upcoming changes:
sketch-owned return and parent-scope variables and functions named `line`
colliding with `std::solver::line`. KCL 3 and earlier retain solver precedence
over those parent bindings; KCL 4 and later give the parent bindings precedence
and reject block-owned return. Preserve historical expectations while adding KCL
4 cases in stage 4. Use another existing Rust test seam only for functionality
simulations cannot exercise. TypeScript tests cover TypeScript functionality,
such as application AST handling, source selection, path conversion, and editing
state, rather than KCL execution semantics.

Deliver the work in four dependent, separately reviewable stages:

1. Add regression tests against the current sketch behavior and establish a
   passing baseline.
2. Add generalized AST types capable of attaching blocks to every existing
   function-call form. Leave them unused by parsing and execution; this stage
   does not enable new syntax or semantics.
3. Migrate existing sketches to the generalized representation and update the
   Rust implementation and TypeScript consumers together. Preserve current
   execution, parsing, validation, and editing behavior. This stage changes
   representation without enabling the KCL 4 semantics; currently accepted
   preview programs also retain their behavior until the next stage. Complete
   the replacement so applications handle one sketch-block kind.
4. Enable generalized parsing and semantics only for KCL 4, including
   `4.0-preview`, and later. This includes the builtin Block type, block
   argument binding and transport, the ordinary sketch function,
   lexical-before-opened-module lookup, and block-owned return rejection. KCL 3
   and earlier retain the behavior pinned in stage 1 through the shared
   representation and implementation.

Stage 2 may introduce unused declarations alongside the existing active AST; it
does not introduce a second live sketch implementation. Stage 3 completes their
replacement. Capturing the current behavior first and separating representation
from semantics lets reviewers assess compatibility independently of the new
language behavior.

The user-facing feature remains limited to KCL 4, including `4.0-preview`, and
later, as recorded in [the KCL language
decision](../../rust/dev-docs/adr/0001-kcl-4-generalized-blocks.md). The feature
originates in the [KCL Blocks RFC, kcl-experiments PR
#32](https://github.com/KittyCAD/kcl-experiments/pull/32); its Future
Possibilities remain outside this project's scope.
