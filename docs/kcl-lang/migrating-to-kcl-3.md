---
title: "Migrating from KCL 2.0 to 3.0"
excerpt: "How to update a KCL program written for KCL 2.0 so that it runs under KCL 3.0."
layout: manual
---

KCL 3.0 is a major improvement to the language that includes greatly improved
fillets and the ability to define named views.

In addition to the new features, KCL 3.0 changes a few language rules and
simplifies some standard library parameters. This page lists every change and
shows how to update a program written for KCL 2.0. Each section has a "before"
example that runs under KCL 2.0 and an "after" example that runs under KCL 3.0.

KCL 3.0 is available as a preview. To use it, declare the version as the
string `"3.0-preview"`, with the quotes, in the
[settings attribute](/docs/kcl-lang/settings) at the top of the file you
execute:

```kcl
@settings(kclVersion = "3.0-preview")
```

The version declared by the file you execute governs the whole program,
including every file it imports. A program cannot run partly under KCL 2.0
and partly under KCL 3.0, so migrate a project as a unit.

## Migration steps

1. Change `kclVersion` to `"3.0-preview"` in the file you execute and in
   every file it imports that declares a version. See
   [All files must declare the same version](#all-files-must-declare-the-same-version).
2. Run the program and fix each error using the sections below. Most changes
   produce an error that points at the code to update.
3. Check the resulting geometry. Some changes alter a model without an error:
   `fillet` and `chamfer` run in order with other operations and follow
   tangent chains by default, and `sweep` no longer moves the profile to the
   path by default.

## Summary of changes

| Change | In KCL 3.0 | What to do |
| --- | --- | --- |
| `return` exits the function immediately | Statements after an executed `return` do not run | Move statements you need before the `return` |
| `if` branches have their own scope | A variable declared in a branch is undefined after the `if` | Use the value of the `if` expression, or declare the variable before it |
| The object is evaluated before the index | In `a[b]`, `a` is evaluated before `b` | Usually nothing; check the order of operations if both sides create geometry |
| `fillet` and `chamfer` run in order | An edge consumed by a cut cannot be looked up afterwards | Look up edges before the cut and store them in variables |
| `fillet` and `chamfer` follow tangent chains | Edges tangent to the selected edges are also cut | Pass `tangentChain = false` to cut only the selected edges |
| `sweep` no longer accepts `relativeTo` | The profile stays in place unless you say otherwise | Pass `translateProfileToPath = true` to move the profile to the path |
| `legacyMethod` is removed | Passing it to `fillet`, `chamfer`, `union`, `intersect`, `subtract`, or `split` is an error | Remove the argument |
| `patternLinear2d` requires a region | Passing a sketch block's sketch is an error | Pass a `region(...)` instead |
| `defaultAngleUnit` is removed | The setting is an error | Write units on angles, like `90deg` or `0.5rad` |
| All files must declare the same version | An imported file declaring a different version is an error | Declare `"3.0-preview"` in every file |

## `return` exits the function immediately

In KCL 2.0, `return` recorded the function's result, but execution continued
to the end of the function body. Statements after the `return` still ran. In
KCL 3.0, the first `return` that executes ends the function. Statements after
it do not run, and a `return` inside an `if` branch returns from the
enclosing function.

If a function has statements after a `return` that you rely on, move them
before the `return`. Otherwise, delete them.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

fn clearanceHole(@boltDiameter) {
  return boltDiameter * 1.1
  // KCL 2.0 keeps executing after the `return`, so this check still runs.
  assert(boltDiameter, isGreaterThan = 0mm, error = "bolt diameter must be positive")
}

holeDiameter = clearanceHole(6mm)
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

fn clearanceHole(@boltDiameter) {
  // Everything the function must do goes before the `return`.
  assert(boltDiameter, isGreaterThan = 0mm, error = "bolt diameter must be positive")
  return boltDiameter * 1.1
}

holeDiameter = clearanceHole(6mm)
```

## Variables declared in `if` branches stay in the branch

In KCL 2.0, a variable declared inside an `if`, `else if`, or `else` branch
was visible after the `if` expression, and giving a branch variable the same
name as an outer variable was an error. In KCL 3.0, each branch body has its
own scope. A variable declared in a branch is visible from its declaration to
the branch's closing brace and never outside it, and it may shadow a variable
from an enclosing scope.

If code after an `if` uses a variable declared inside a branch, use the value
of the `if` expression instead, or declare the variable before the `if`.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

useMetric = true
plateThickness = if useMetric {
  thickness = 5mm
  thickness
} else {
  thickness = 0.25in
  thickness
}
// KCL 2.0 lets `thickness` leak out of the branch that ran.
holeDepth = thickness / 2
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

useMetric = true
plateThickness = if useMetric {
  5mm
} else {
  0.25in
}
// Use the value of the `if` expression.
holeDepth = plateThickness / 2
```

## The object is evaluated before the index

In KCL 2.0, a member expression like `a[b]` evaluated the index `b` before the
object `a`. In KCL 3.0, it evaluates `a` first, in source order. This only
matters when both sides do something observable, such as calling functions
that create geometry or report errors. The geometry is the same, but the
operations run in a different order, which changes their order in the feature
tree and which error is reported first when both sides fail.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

fn plates() {
  plateSketch = sketch(on = XY) {
    thin = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
    thick = circle(start = [var 25mm, var 0mm], center = [var 20mm, var 0mm])
  }
  thinPlate = extrude(region(segments = [plateSketch.thin]), length = 2mm)
  thickPlate = extrude(region(segments = [plateSketch.thick]), length = 6mm)
  return [thinPlate, thickPlate]
}

fn pickIndex() {
  markerSketch = sketch(on = XY) {
    marker = circle(start = [var -18mm, var 0mm], center = [var -20mm, var 0mm])
  }
  marker = extrude(region(segments = [markerSketch.marker]), length = 1mm)
  return 1
}

// KCL 2.0 runs pickIndex() first, so the marker is created before the plates.
picked = plates()[pickIndex()]
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

fn plates() {
  plateSketch = sketch(on = XY) {
    thin = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
    thick = circle(start = [var 25mm, var 0mm], center = [var 20mm, var 0mm])
  }
  thinPlate = extrude(region(segments = [plateSketch.thin]), length = 2mm)
  thickPlate = extrude(region(segments = [plateSketch.thick]), length = 6mm)
  return [thinPlate, thickPlate]
}

fn pickIndex() {
  markerSketch = sketch(on = XY) {
    marker = circle(start = [var -18mm, var 0mm], center = [var -20mm, var 0mm])
  }
  marker = extrude(region(segments = [markerSketch.marker]), length = 1mm)
  return 1
}

// KCL 3.0 runs plates() first, so the plates are created before the marker.
picked = plates()[pickIndex()]
```

## `fillet` and `chamfer` run in order with other operations

In KCL 2.0, `fillet` and `chamfer` were deferred until the end of the program,
after every other modeling operation. In KCL 3.0, they are sent to the engine
immediately, in order with the other operations.

This has two consequences:

- Cutting an edge replaces it with a new face. Looking up an edge that a
  fillet or chamfer has already consumed, for example with
  `getOppositeEdge` or `getNextAdjacentEdge`, is an error. Look up the edges
  you need before the cut and store them in variables.
- Operations that follow a fillet or chamfer, such as a boolean or a sketch
  on one of its faces, now see the cut solid.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

profile = sketch(on = XY) {
  bottom = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  right = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  top = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  left = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
}
block = region(point = [5mm, 5mm], sketch = profile)
body = extrude(block, length = 5mm)
  |> fillet(radius = 1mm, tags = [block.tags.right])
  // KCL 2.0 defers the fillet, so the edge opposite `right` still exists here.
  |> chamfer(length = 1mm, tags = [getOppositeEdge(block.tags.right)])
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

profile = sketch(on = XY) {
  bottom = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  right = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  top = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  left = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
}
block = region(point = [5mm, 5mm], sketch = profile)
body = extrude(block, length = 5mm)
// Look up the edge before the fillet consumes the edge it is opposite to.
topRightEdge = getOppositeEdge(block.tags.right)
rounded = body
  |> fillet(radius = 1mm, tags = [block.tags.right])
  |> chamfer(length = 1mm, tags = [topRightEdge])
```

## `fillet` and `chamfer` follow tangent chains

KCL 3.0 adds the `tangentChain` parameter to `fillet` and `chamfer`. When it
is true, the cut also applies to edges that are tangent to the selected
edges, so selecting one edge of a smooth loop, such as the top edge of a slot,
cuts the whole loop. It defaults to true. KCL 2.0 cut only the edges you
listed.

To keep the KCL 2.0 result, pass `tangentChain = false`.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

slot = sketch(on = XY) {
  top = line(start = [var -10mm, var 5mm], end = [var 10mm, var 5mm])
  rightArc = arc(start = [var 10mm, var -5mm], end = [var 10mm, var 5mm], center = [var 10mm, var 0mm])
  bottom = line(start = [var 10mm, var -5mm], end = [var -10mm, var -5mm])
  leftArc = arc(start = [var -10mm, var 5mm], end = [var -10mm, var -5mm], center = [var -10mm, var 0mm])
  coincident([top.end, rightArc.end])
  coincident([rightArc.start, bottom.start])
  coincident([bottom.end, leftArc.end])
  coincident([leftArc.start, top.start])
  tangent([top, rightArc])
  tangent([rightArc, bottom])
  tangent([bottom, leftArc])
  tangent([leftArc, top])
}
slotRegion = region(point = [0mm, 0mm], sketch = slot)
body = extrude(slotRegion, length = 4mm, tagEnd = $cap)
// Only the edge between the `top` face and the end cap is filleted.
rounded = fillet(body, radius = 1mm, tags = [getCommonEdge(faces = [slotRegion.tags.top, cap])])
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

slot = sketch(on = XY) {
  top = line(start = [var -10mm, var 5mm], end = [var 10mm, var 5mm])
  rightArc = arc(start = [var 10mm, var -5mm], end = [var 10mm, var 5mm], center = [var 10mm, var 0mm])
  bottom = line(start = [var 10mm, var -5mm], end = [var -10mm, var -5mm])
  leftArc = arc(start = [var -10mm, var 5mm], end = [var -10mm, var -5mm], center = [var -10mm, var 0mm])
  coincident([top.end, rightArc.end])
  coincident([rightArc.start, bottom.start])
  coincident([bottom.end, leftArc.end])
  coincident([leftArc.start, top.start])
  tangent([top, rightArc])
  tangent([rightArc, bottom])
  tangent([bottom, leftArc])
  tangent([leftArc, top])
}
slotRegion = region(point = [0mm, 0mm], sketch = slot)
body = extrude(slotRegion, length = 4mm, tagEnd = $cap)
// Without `tangentChain = false`, the fillet would continue around the
// whole top edge of the slot.
rounded = fillet(
  body,
  radius = 1mm,
  tags = [getCommonEdge(faces = [slotRegion.tags.top, cap])],
  tangentChain = false,
)
```

## `sweep` positions the profile with two flags

KCL 3.0 removes the `relativeTo` parameter of `sweep`. Use
`translateProfileToPath` and `orientProfilePerpendicular` instead:

- `translateProfileToPath` moves the profile to the start of the path before
  sweeping. It defaults to false.
- `orientProfilePerpendicular` turns the profile so that it is perpendicular
  to the path before sweeping. In KCL 3.0, it defaults to the value of
  `translateProfileToPath`, so a profile that is moved to the path is also
  turned to face along it unless you say otherwise.

The default behavior changed as well. In KCL 2.0, a `sweep` with no
positioning arguments turned the profile to face along the path. In KCL 3.0,
a `sweep` with neither flag leaves the profile where it is, in its current
orientation. When the profile is not already at the start of the path and
perpendicular to it, this gives a different shape. To reproduce a KCL 2.0
sweep, remove `relativeTo`, pass `translateProfileToPath = true`, and check
the result.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

profileSketch = sketch(on = XY) {
  ring = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
pathSketch = sketch(on = XZ) {
  path = line(start = [var 30mm, var 0mm], end = [var 60mm, var 40mm])
}
// KCL 2.0 turns the profile to face along the path.
tube = sweep(region(segments = [profileSketch.ring]), path = [pathSketch.path])
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

profileSketch = sketch(on = XY) {
  ring = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
pathSketch = sketch(on = XZ) {
  path = line(start = [var 30mm, var 0mm], end = [var 60mm, var 40mm])
}
// Move the profile to the start of the path. Because
// `orientProfilePerpendicular` follows `translateProfileToPath`, the
// profile is also turned to face along the path.
tube = sweep(
  region(segments = [profileSketch.ring]),
  path = [pathSketch.path],
  translateProfileToPath = true,
)
```

## `legacyMethod` is removed

The `legacyMethod` parameter of `fillet`, `chamfer`, `union`, `intersect`,
`subtract`, and `split` opted back into an older engine algorithm. It was
deprecated in KCL 2.0 and is removed in KCL 3.0. Passing it is an error.
Remove the argument.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

sketchA = sketch(on = XY) {
  bottom = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  right = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  top = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  left = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
}
partA = extrude(region(point = [5mm, 5mm], sketch = sketchA), length = 10mm)

sketchB = sketch(on = XY) {
  bottom = line(start = [var 5mm, var 5mm], end = [var 15mm, var 5mm])
  right = line(start = [var 15mm, var 5mm], end = [var 15mm, var 15mm])
  top = line(start = [var 15mm, var 15mm], end = [var 5mm, var 15mm])
  left = line(start = [var 5mm, var 15mm], end = [var 5mm, var 5mm])
}
partB = extrude(region(point = [10mm, 10mm], sketch = sketchB), length = 5mm)
  |> translate(z = 2mm)

joined = union([partA, partB], legacyMethod = false)
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

sketchA = sketch(on = XY) {
  bottom = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  right = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  top = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  left = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
}
partA = extrude(region(point = [5mm, 5mm], sketch = sketchA), length = 10mm)

sketchB = sketch(on = XY) {
  bottom = line(start = [var 5mm, var 5mm], end = [var 15mm, var 5mm])
  right = line(start = [var 15mm, var 5mm], end = [var 15mm, var 15mm])
  top = line(start = [var 15mm, var 15mm], end = [var 5mm, var 15mm])
  left = line(start = [var 5mm, var 15mm], end = [var 5mm, var 5mm])
}
partB = extrude(region(point = [10mm, 10mm], sketch = sketchB), length = 5mm)
  |> translate(z = 2mm)

joined = union([partA, partB])
```

## `patternLinear2d` requires a region

In KCL 2.0, passing the sketch produced by a sketch block directly to
`patternLinear2d` was deprecated with a warning. In KCL 3.0, it is an error.
Select the profile to pattern with `region` and pass the region instead.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0)

profile = sketch(on = XY) {
  hole = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
}
holes = patternLinear2d(profile, instances = 3, distance = 10mm, axis = X)
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

profile = sketch(on = XY) {
  hole = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
}
holes = patternLinear2d(region(segments = [profile.hole]), instances = 3, distance = 10mm, axis = X)
```

## `defaultAngleUnit` is removed

The `defaultAngleUnit` setting was deprecated in KCL 2.0 and is removed in
KCL 3.0. Declaring it is an error. Remove it from the settings attribute and
write the unit on every angle, like `90deg` or `1.57rad`.

KCL 2.0:

```kcl
@settings(kclVersion = 2.0, defaultAngleUnit = deg)

profile = sketch(on = XY) {
  disk = circle(start = [var 2mm, var 5mm], center = [var 0mm, var 5mm])
}
// The bare 90 is read as degrees because of `defaultAngleUnit`.
ring = revolve(region(segments = [profile.disk]), axis = X, angle = 90)
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

profile = sketch(on = XY) {
  disk = circle(start = [var 2mm, var 5mm], center = [var 0mm, var 5mm])
}
ring = revolve(region(segments = [profile.disk]), axis = X, angle = 90deg)
```

## All files must declare the same version

In KCL 2.0, each file ran under the version it declared, so a program could
mix files declaring `1.0` and `2.0`. In KCL 3.0, the version declared by the
file you execute governs the whole program. Every imported file that declares
a `kclVersion` must declare the same version, and an imported file that
declares no version uses the executed file's version. Declaring the version
in every file is recommended, so that opening an imported file on its own
does not run it under the default of `1.0`.

The check works in both directions. A file that declares `"3.0-preview"` can
only be imported by a file that declares `"3.0-preview"`, so migrating only
some files of a project is an error either way.

KCL 2.0:

```kcl,norun
// main.kcl
@settings(kclVersion = 2.0)

import width from "dimensions.kcl"

x = width
```

```kcl,norun
// dimensions.kcl
@settings(kclVersion = 1.0)

export width = 10mm
```

KCL 3.0:

```kcl,norun
// main.kcl
@settings(kclVersion = "3.0-preview")

import width from "dimensions.kcl"

x = width
```

```kcl,norun
// dimensions.kcl
@settings(kclVersion = "3.0-preview")

export width = 10mm
```

If you update `main.kcl` but not `dimensions.kcl`, executing `main.kcl`
reports an error like this:

```
Mixing KCL versions in a single program is not allowed. The entry point declares kclVersion 3.0-preview, but the imported file `dimensions.kcl` declares kclVersion 2.0. Update the kclVersion setting in one of these files to match the other.
```

## Recommended: replace deprecated sketch functions with sketch blocks

This step is not required, but strongly recommended. The pipeline-style sketch
functions from KCL 1.0 have been deprecated since KCL 2.0. The functions such as
`startSketchOn`, `startProfile`, and `close`, and the segment functions used in
those pipelines, such as `line`, `xLine`, `angledLine`, `arc`, `tangentialArc`,
`circle`, `rectangle`, and `polygon`, still work in KCL 3.0 and report a
deprecation warning. The functions of the same name used inside a sketch block,
such as `line` and `arc`, are not deprecated. While you are updating a file,
consider rewriting these profiles as [sketch blocks](/docs/kcl-lang/sketches)
and selecting the profile to extrude with
[`region`](/docs/kcl-std/functions/std-sketch-region) so that you can take
advantage of geometric sketch constraints.

KCL 1.0:

```kcl
@settings(kclVersion = 1.0)

bracket = startSketchOn(XY)
  |> startProfile(at = [0mm, 0mm])
  |> line(end = [30mm, 0mm])
  |> line(end = [0mm, 20mm])
  |> line(end = [-30mm, 0mm])
  |> close()
  |> extrude(length = 5mm)
```

KCL 3.0:

```kcl
@settings(kclVersion = "3.0-preview")

bracketProfile = sketch(on = XY) {
  bottom = line(start = [var 0mm, var 0mm], end = [var 30mm, var 0mm])
  right = line(start = [var 30mm, var 0mm], end = [var 30mm, var 20mm])
  top = line(start = [var 30mm, var 20mm], end = [var 0mm, var 20mm])
  left = line(start = [var 0mm, var 20mm], end = [var 0mm, var 0mm])
  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
  horizontal(bottom)
  vertical(right)
  horizontal(top)
  vertical(left)
}
bracket = extrude(region(point = [15mm, 10mm], sketch = bracketProfile), length = 5mm)
```
