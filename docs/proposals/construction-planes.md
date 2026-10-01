# Proposal: typed construction planes in KCL and the modeling app

Status: draft for API and interaction review. Related: [#11204](https://github.com/KittyCAD/modeling-app/issues/11204).

This PR proposes language additions and point-and-click workflows. It does not
implement or expose the proposed functions. All implementation described here
belongs in this repository; no engine repository changes or new engine commands
are proposed. Examples using new functions are illustrative future KCL, not
currently executable samples.

## Motivation and current behavior

KCL accepts custom plane objects containing `origin`, `xAxis`, and `yAxis`.
These objects are coerced to planes when used. A typed constructor should validate
geometry at construction time, rather than waiting until a sketch consumes it.
An infinite plane alone does not define sketch coordinates: each constructor must
also specify an origin and an oriented, right-handed orthonormal frame.

Existing foundations in this repository:

- `rust/kcl-lib/std/prelude.kcl` exposes `offsetPlane(...): Plane`.
- `rust/kcl-lib/std/sketch.kcl` exposes `planeOf` for planar solid faces.
- `rust/kcl-lib/src/std/planes.rs` builds runtime `Plane` values and scene objects.
- `rust/kcl-lib/src/std/sketch.rs` contains `PlaneData` and custom-plane coercion.
- `src/lib/commandBarConfigs/modelingCommandStdLib.ts` gives Offset plane an edit
  flow, with selection and distance arguments in `modelingCommandConfig.ts`.
- `src/lang/modifyAst/faces.ts` implements `addOffsetPlane`.
- `src/lib/selectSketchPlane.ts` and `src/lang/queryAst.ts` contain selection paths
  that currently name or recognize offset planes specifically.

These provide implementation patterns, not proof that all proposed selection
types or reference queries already exist.

## First increment: `plane` returns `Plane`

Expose `plane` through the prelude with four mutually exclusive keyword groups.
The following are API shapes, not declarations using a new overload syntax.
The implementation must reject missing, mixed, and unknown arguments before
creating a runtime artifact. Do not silently choose a group by argument precedence.

| Method | Required arguments | Sketch origin and orientation |
| --- | --- | --- |
| Axes and origin | `origin`, `xAxis`, `yAxis` | Origin as supplied; normalize axes, require perpendicularity; normal is X cross Y |
| Point and normal | `origin`, `normal`, `xAxis` | Origin as supplied; project X direction into the plane; Y is normal cross X |
| Three points | `points` (exactly three ordered points) | First point is origin; first-to-second is +X; ordered cross product determines normal |
| Equation | `a`, `b`, `c`, `d`, `xAxis` | Closest point on plane to world origin; normal follows coefficient sign; project X into plane |

No automatic world-axis fallback for normal or equation forms: it introduces a
discontinuous sketch rotation when a normal crosses the fallback threshold.
Require `xAxis` so the author controls in-plane rotation. The app may offer a
visible default world direction, but must write that direction into KCL and
require another direction if it becomes parallel to the normal.

### Proposed KCL examples

```kcl
@settings(kclVersion = 2.0, defaultLengthUnit = mm)

axesPlane = plane(
  origin = [0mm, 0mm, 20mm],
  xAxis = [1, 0, 0],
  yAxis = [0, 1, 0],
)
normalPlane = plane(
  origin = [0mm, 0mm, 20mm],
  normal = [0, 0, 1],
  xAxis = [1, 0, 0],
)
threePointPlane = plane(points = [
  [0mm, 0mm, 20mm],
  [10mm, 0mm, 20mm],
  [0mm, 10mm, 20mm]
])
equationPlane = plane(a = 0, b = 0, c = 1, d = -20mm, xAxis = [1, 0, 0])

profile = sketch(on = threePointPlane) {
  segment = line(start = [0mm, 0mm], end = [10mm, 0mm])
}
```

All four examples produce origin `[0mm, 0mm, 20mm]`, +X along world X, +Y along
world Y, and normal +Z. The issue's example three points are collinear; they must
produce a diagnostic, not a plane.

Points and directions accept either three-element arrays or `{x, y, z}` objects,
as existing plane input does. Point components are lengths (unitless input uses
the existing default-length rules); direction components are dimensionless.
Convert point components to a common length unit before doing vector math.
Reject dimensioned directions and incompatible units rather than stripping units.

For the equation `a*x + b*y + c*z + d = 0`, `a`, `b`, and `c` are dimensionless
and `d` is a length. With `n = [a,b,c]`, origin is `-d*n/dot(n,n)`.
Positive scaling of all coefficients preserves the entire frame; negative scaling
reverses normal and Y while preserving the projected X direction. Normalize
coefficients using a numerically stable scale before evaluating this expression.

### Frame construction and errors

- Axes form: normalize X and Y; reject nonperpendicular axes outside tolerance.
  Within tolerance, remove the tiny Y component along X and renormalize. Do not
  silently orthogonalize substantially skew axes. Z is normalized X cross Y.
- Normal form: normalize normal N; X is normalized `xAxis - dot(xAxis,N)*N`;
  Y is N cross X. `xAxis` is explicitly an orientation hint, not a required
  tangent vector. Reject it if its projection is degenerate.
- Three-point form: X is normalized P1-P0; N is normalized
  `(P1-P0) cross (P2-P0)`; Y is N cross X. Swapping the last two points changes
  both X and normal according to those definitions. Do not sort selections.
- Equation form: reject a zero coefficient normal, compute the origin as above,
  then use the normal-form frame rules.

Reject nonfinite numbers, zero vectors, duplicate points, collinear points,
incorrect array lengths, incompatible units, and invalid keyword combinations.
Associate errors with the relevant argument source ranges. Example messages:
"The normal must be nonzero", "The X direction is parallel to the normal",
"The three points must not be collinear", and "Choose one plane definition".
Validate before registering a plane or submitting geometry commands.

Use shared KCL geometry tolerances where available. Direction tests operate on
normalized vectors; collinearity uses the sine of the angle between point
differences, with a separate length-aware coincidence check. Avoid a fixed
world-space cross-product cutoff whose behavior changes between mm and inches.
The exact shared tolerance values remain an implementation review decision and
must be pinned by tests before shipping.

## Additional construction methods

Keep `offsetPlane` and `planeOf` unchanged. Add these after the primitive
constructor, using separate names so mutually exclusive argument groups remain
manageable. These are proposed APIs, not existing stdlib functions.

| Method | Proposed call | Frame rule |
| --- | --- | --- |
| Parallel through point | `parallelPlane(base, origin = [0mm, 0mm, 30mm])` | Supplied point is origin; inherit base X/Y/Z |
| Angle about line | `angledPlane(base, axisOrigin = [0mm, 0mm, 0mm], axisDirection = [1, 0, 0], angle = 30deg)` | Rotate base origin and all axes about the directed line using the right-hand rule |
| Parallel midplane | `midPlane(first, second = other)` | Project first origin onto second; midpoint is new origin; inherit first frame |

For angled planes, require the axis line to lie in the base plane. This defines a
plane through that line and a meaningful zero-angle reference. Reject zero axis
directions and nonfinite angles; accept signed angles. Selecting a straight edge
provides a directed line, with an explicit Reverse axis control.

For midplanes, accept parallel and antiparallel normals, including coincident
planes; reject intersecting planes in this increment. Coincident planes return
the first frame. Signed separation is computed along the first normal, so
opposite normal signs do not cancel. Reversing input order intentionally inherits
the other frame. Angular bisectors need a separate choice between two solutions.

Defer intersecting-plane bisectors, curve-normal planes, and tangent-to-curved-face
planes. They require additional geometric reference semantics and queries that
this proposal does not establish. The [Onshape plane documentation](https://cad.onshape.com/help/Content/PartStudio/plane.htm)
linked in the issue is a useful list of methods; it is not the coordinate-frame
contract for KCL.

## Point-and-click: Construction plane

Add a **Construction plane** entry to the modeling toolbar and command palette.
Its first field is Method. Keep the existing Offset plane entry as a shortcut.
Preselecting a plane or planar face defaults to Offset; otherwise show the method
chooser. Only offer methods whose KCL implementation and reference conversion
are available in the running Wasm bundle.

| Method | Ordered inputs | Generated expression |
| --- | --- | --- |
| Offset | Plane/planar face, signed distance | Existing `offsetPlane` (with `planeOf` for a face) |
| Axes and origin | Origin point, X direction, perpendicular Y direction | `plane(origin = ..., xAxis = ..., yAxis = ...)` |
| Point and normal | Origin point, normal direction, X direction | `plane(origin = ..., normal = ..., xAxis = ...)` |
| Three points | Origin, point on +X, point on +Y side | `plane(points = [...])` in selection order |
| Equation | Four numeric fields, X direction | `plane(a = ..., b = ..., c = ..., d = ..., xAxis = ...)` |
| Parallel through point | Plane/planar face, origin point | `parallelPlane(...)` |
| Angle about line | Plane/planar face, straight line, signed angle | `angledPlane(...)` |
| Parallel midplane | Two planes/planar faces | `midPlane(...)` |

Directions support world axes, numeric vectors, and supported straight-line
references. Points support numeric coordinates, world origin, and resolvable
sketch points/vertices. Do not accept arbitrary background clicks as 3D points:
they have no unique depth. Show input roles (Origin, X point, Y-side point), allow
replacement/reordering, and filter selection by the active role. Duplicate
selections remain visible with an error rather than disappearing silently.

Preview a translucent finite rectangle with labeled origin, +X/+Y arrows, and a
normal arrow. Its visual size does not change the mathematical plane. Include
Flip normal, emitted using existing plane negation only after confirming its
frame semantics match the preview. Show invalid input beside the offending field;
disable Create until validation and preview execution succeed. Preserve inputs
when switching back from a failed preview.

Create inserts a named declaration such as `plane001` in dependency order before
its consumers and adds a feature-tree entry. Start sketch consumes that name
using a KCL 2.0 sketch block. Edit restores method, expressions, and ordered
references from the AST; preserve parameter expressions instead of replacing
them with evaluated numbers. Cancel changes no document state; Create and Edit
each form one undoable operation. Remove unused face-plane helper declarations
only when dependency analysis proves they have no other consumers.

### Reference persistence and preview ownership

Numeric inputs are fully supported without new reference APIs. Point-and-click
selection is enabled only when the selected entity can be expressed through an
existing stable KCL reference/query. Translate sketch-local points into world
coordinates through their support frame; direction values must be world-space
directions, not screen coordinates. Re-evaluate expressions when upstream
geometry changes.

Never serialize transient engine IDs or silently bake picked geometry into
coordinates. If a selection has no existing stable KCL representation, report
that limitation and allow an explicitly labeled coordinate snapshot as a
nonassociative alternative. Any missing reference accessors must be proposed and
implemented in this repository against existing data/commands before enabling
that selection type. Loss of a reference yields a recoverable diagnostic, not
fallback geometry or a different sketch frame.

Associate preview results with the current input revision and project/file.
Discard late results after input changes, cancel, or project switches. Previews
must not leave persistent features, artifacts, or helper declarations. Use the
same KCL frame validation for preview and final execution to prevent disagreement.

## Implementation plan within modeling-app

1. Add primitive declarations/doc comments in `rust/kcl-lib/std/prelude.kcl`,
   implementations in `rust/kcl-lib/src/std/planes.rs`, and registration in
   `rust/kcl-lib/src/std/mod.rs`. Resolve the keyword-group typing/metadata
   representation before adding command-bar introspection. Return a runtime
   `KclValue::Plane` with source metadata and existing scene/artifact lifecycle.
2. Reuse existing plane initialization and sketch support commands. Frame math
   runs in KCL; no new engine protocol, engine geometry algorithm, or engine
   repository edit is required for primitive numeric constructors. Confirm this
   with integration tests before enabling the feature.
3. Register example tests and regenerate stdlib docs/bindings using this repo's
   normal generation workflow. Do not hand-edit `docs/kcl-std` or generated TS.
4. Extend command schemas/configuration/codemods in
   `src/lib/commandBarConfigs`, and the modeling machine events/actors. Add method
   selection and review validation without making every overload argument
   simultaneously required by command introspection.
5. Generalize custom-plane selection and feature-tree edit paths in
   `src/lib/selectSketchPlane.ts`, `src/lang/queryAst.ts`, and relevant selection
   helpers beyond checks for `offsetPlane`. Validate both web and desktop flows.
6. Ship parallel/angle/parallel-midplane helpers and their UI methods in separate
   increments after constructor behavior and reference persistence are settled.

Existing object coercion, default planes, `offsetPlane`, and `planeOf` retain their
behavior. Stricter validation initially applies only to the new constructors;
changing old object coercion requires separate compatibility review. Do not
rewrite old source on load. New constructors should be feature-tree-producing
operations like `offsetPlane`, even when no sketch uses them yet.

## Acceptance criteria for implementation PRs

- Pure frame tests cover all forms, arrays/objects, handedness, unit conversion,
  positive/negative coefficient scaling, translated three-point inputs, and all
  degenerate/mixed-argument cases. Assert explicit expected origins and axes,
  not only successful construction. Typed return is checked before sketch use.
- Integration tests create sketches on each form and compare world placement
  against equivalent existing custom-plane objects. Verify source diagnostics,
  artifact identity/lifecycle, reevaluation, and default-plane compatibility.
- AST tests cover insertion order, parameters, method edits, face-helper sharing,
  deletion, and preservation of unrelated statements/comments.
- Web-tagged Playwright tests cover creation, preview, ordered selection,
  invalid inputs, start sketch, feature-tree edit, flip, undo/redo, cancel,
  save/reload, upstream edits, and missing references. Exercise rotated sketch
  points and hidden support geometry, plus sketches containing arcs and tangent
  constraints so placement regressions do not disturb downstream geometry.
- Preview tests change inputs and switch projects while work is in flight;
  stale results must neither overwrite source nor commit geometry.
- Parallel helper tests cover antiparallel/coincident parents and reject
  intersecting midplanes; angle tests cover axis reversal and signed angles.

This draft itself changes documentation only. No proposed API or UI behavior has
been implemented or runtime-tested by this PR.

## Review decisions

1. Confirm explicit `xAxis` for normal/equation forms rather than implicit roll.
2. Confirm strict perpendicular axes versus intentional Gram-Schmidt semantics.
3. Confirm keyword-group typing and the staged helper names before implementation.
4. Inventory stable point/line references and shared tolerances available today;
   gate individual selection types on that evidence rather than promising an
   engine-dependent capability.
