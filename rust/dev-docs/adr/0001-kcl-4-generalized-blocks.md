# Introduce generalized blocks in KCL 4

The feature follows the [KCL Blocks RFC, kcl-experiments PR #32](https://github.com/KittyCAD/kcl-experiments/pull/32). The RFC's Future Possibilities are outside this project's scope.

Generalized KCL blocks are available only in KCL 4, including `4.0-preview`, and later. This includes the builtin `Block` type as well as trailing-block syntax and execution. Sketch blocks use the generalized mechanism in those versions. KCL 3 and earlier retain their special sketch construct and execution behavior, because migrating those versions could break existing programs. The existing entry-point version policy continues to govern imported modules.

The project includes generalized blocks, sketch migration, and the formatter and editor support needed for existing sketch workflows. Full sketch editing and solver completions are required for direct builtin `sketch()` calls. Arbitrary user-defined forwarding wrappers receive generic code editing support; inferring their sketch context is a separate tooling capability. New assembly, CAM, and drawing DSLs are outside this project's scope.

The accompanying decisions record [type-directed call binding and the sketch API](0002-type-directed-block-calls.md) and [opaque, reusable block values and their evaluation](0003-opaque-reusable-block-values.md).
