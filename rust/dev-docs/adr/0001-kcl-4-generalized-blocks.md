# Introduce generalized blocks in KCL 4

The feature follows the [KCL Blocks RFC, kcl-experiments PR
#32](https://github.com/KittyCAD/kcl-experiments/pull/32). The RFC's Future
Possibilities are outside this project's scope.

User-facing generalized KCL blocks are available only in KCL 4, including
`4.0-preview`, and later. This includes the builtin `Block` type and generalized
trailing-block calls. The existing entry-point version policy continues to
govern imported modules.

Internally, sketch blocks in every KCL version use [one shared implementation
and
representation](../../../dev-docs/adr/0001-shared-sketch-block-implementation.md).
The program's KCL version selects behavioral differences within that
implementation. KCL 3 and earlier retain their existing sketch syntax and
observable behavior, because changing those semantics could break existing
programs. TypeScript handles one kind of sketch block across versions.

The project includes generalized blocks, sketch migration, and the formatter and
editor support needed for existing sketch workflows. Full sketch editing and
solver completions are required for direct builtin `sketch()` calls. Arbitrary
user-defined forwarding wrappers receive generic code editing support; inferring
their sketch context is a separate tooling capability. New assembly, CAM, and
drawing DSLs are outside this project's scope.

The shared-implementation decision requires a passing regression baseline before
changes to the current sketch implementation or representation. The baseline
pins historical language behavior and sketch-editing contracts; generalized KCL
4 behavior is covered separately.

The accompanying decisions record [type-directed call binding and the sketch
API](0002-type-directed-block-calls.md) and [opaque, reusable block values and
their evaluation](0003-opaque-reusable-block-values.md).
