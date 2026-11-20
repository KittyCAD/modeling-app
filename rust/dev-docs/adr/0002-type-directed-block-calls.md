# Bind trailing blocks by resolved parameter type

Following the [KCL Blocks
RFC](https://github.com/KittyCAD/kcl-experiments/pull/32), trailing blocks bind
to the first parameter in declaration order whose resolved type is exactly
`Block`. Aliases to `Block` and optional parameters such as `code?: Block`
qualify; `any` and unions such as `Block | none` do not. Exact type recognition
supports aliases without making every permissive parameter a block parameter,
and avoids reserving a parameter name, position, or new sigil.

An unlabeled receiver declared as `@code: Block` participates in the same
source-order rule. Supplying the selected parameter both through a trailing
block and through a named argument, positional argument, or pipeline is a
duplicate-argument error. Binding never skips an already-supplied first block
parameter to select a later one. This prevents the block from silently replacing
a pipeline receiver.

In KCL 4 and later, `sketch` is an ordinary function binding. Qualified and
aliased calls can receive trailing blocks, and a local `sketch` binding can
shadow the builtin. This removes the callee-name exception from the language.
The shared implementation preserves earlier versions' existing special sketch
behavior through version checks, as described in [ADR
0001](0001-kcl-4-generalized-blocks.md).

The builtin lives at `std::sketch::sketch` and is re-exported through the
prelude. It retains the required labeled `on` argument and adds a required
`block: Block` parameter; an empty block remains valid. Wrappers can forward an
existing value with `sketch(on = plane, block = savedBlock)`. Using the existing
sketch module gives the function a public home without exposing it through the
solver module, which is restricted to active sketch execution.

Following the RFC, generalized block literals can only be created as trailing
blocks on existing function-call forms. In KCL 4 and later, calls with trailing
blocks are disallowed in `if` and `else if` conditions to avoid brace ambiguity.
Passing an existing block value as an ordinary argument in a condition remains
valid; no new block-expression syntax is introduced. Earlier versions retain
their existing sketch parsing behavior.
