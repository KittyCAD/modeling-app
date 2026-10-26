---
title: "Sketch Blocks and Constraints"
excerpt: "Write constrained, editable sketches with KCL sketch blocks."
layout: manual
---

KCL sketch blocks define 2D geometry and the relationships that control it.
Start a block on a base plane or supported face, add sketch geometry inside the
braces, then apply constraints to express design intent.

```kcl
@settings(kclVersion = 3.0)

width = 40mm
height = 24mm

profile = sketch(on = XY) {
  bottom = line(start = [var 0mm, var 0mm], end = [var 40mm, var 0mm])
  right = line(start = [var 40mm, var 0mm], end = [var 40mm, var 24mm])
  top = line(start = [var 40mm, var 24mm], end = [var 0mm, var 24mm])
  left = line(start = [var 0mm, var 24mm], end = [var 0mm, var 0mm])

  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
  horizontal(bottom)
  horizontal(top)
  vertical(right)
  vertical(left)
  horizontalDistance([bottom.start, bottom.end]) == width
  verticalDistance([bottom.start, left.start]) == height
  coincident([bottom.start, ORIGIN])
}
```

Inside a sketch block, the [solver module](/docs/kcl-std/modules/std-solver)
is automatically in scope. Call `line`, `arc`, `circle`, `coincident`, and
other solver functions without a `solver::` prefix.

## `var` values are initial guesses

A value introduced with `var` is a coordinate or size that the solver may
change. It is an initial guess, not a fixed dimension. Initial guesses must be
numeric literals, with a unit where applicable:

```kcl
@settings(kclVersion = 3.0)

exampleSketch = sketch(on = XY) {
  // Valid initial guesses
  samplePoint = point(at = [var 0mm, var -3mm])
  coincident([samplePoint, [0mm, -3mm]])

  // Invalid: identifiers and expressions cannot follow `var`
  // samplePoint = point(at = [var width, var (height / 2)])
}
```

Put identifiers and expressions in constraints when they must drive the solved
result. For example, use `horizontalDistance([edge.start, edge.end]) == width`
rather than `end = [var width, var 0mm]`.

## Fully constrain the sketch

A fully constrained sketch has no unintended degrees of freedom. Use geometric
constraints such as `coincident`, `horizontal`, `vertical`, `parallel`,
`perpendicular`, `equalLength`, `tangent`, and `symmetric` to describe
relationships. Use dimensional constraints such as `distance`,
`horizontalDistance`, `verticalDistance`, `angle`, `radius`, and `diameter` for
driving values.

Anchor the profile once, then constrain the rest of the geometry relative to
that frame. Repeatedly fixing absolute points makes sketches harder to edit and
can over-constrain them. An under-constrained sketch can move in unintended
ways; an over-constrained sketch contains redundant or conflicting
relationships.

See the [constraint reference](/docs/kcl-std/modules/std-solver) for the full
API and the [sketching guide](/docs/zoo-design-studio/features/3d-design/parametric-modeling/sketching)
for the point-and-click workflow.

## Create a region from a closed profile

Most solid features consume a [region](/docs/kcl-std/functions/std-sketch-region)
created from a closed sketch boundary.

For one closed segment, such as a circle, pass that segment by itself. Omit
`intersectionIndex` and `direction`; they are unnecessary for one loop and are
intended to disambiguate a boundary traced from multiple segments.

```kcl
@settings(kclVersion = 3.0)

roundProfile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == 10mm
  horizontal([perimeter.center, perimeter.start])
}

roundRegion = region(segments = [roundProfile.perimeter])
roundBody = extrude(roundRegion, length = 5mm)
```

For a boundary traced from multiple intersecting segments, pass the first two
segments. Use `intersectionIndex` only when they intersect more than once, and
use `direction = CW` when the default counterclockwise trace selects the wrong
boundary.

If segment tracing cannot identify the intended boundary, make the boundary
unambiguous by passing an adjacent segment pair and setting `direction` or
`intersectionIndex` when needed. For new code, prefer correcting the boundary
selection instead of falling back to a coordinate inside the region.

## Control arc direction

An [arc](/docs/kcl-std/functions/std-solver-arc) sweeps counterclockwise from
its start point to its end point by default. If it takes the long or opposite
path, set `direction = CW`. Changing the direction is clearer than swapping
endpoints and then repairing every dependent constraint.

## Experimental 3D sketch blocks

Use `sketch3d() { ... }` to define geometry in world coordinates. The block
has no `on` plane. Points have three length coordinates, and lines, points,
arcs, and circles are independent entities connected with constraints.

```kcl
@settings(kclVersion = 3.0, experimentalFeatures = allow)

spatial = sketch3d() {
  edge = line(start = [0mm, 0mm, 0mm], end = [var 5mm, var 0mm, var 7mm])
  distance([edge.start, edge.end]) == 10mm
  horizontalDistance([edge.start, edge.end]) == 6mm
  verticalDistance([edge.start, edge.end]) == 0mm

  bend = arc(
    start = [var 10mm, 0mm, 20mm],
    end = [0mm, var 10mm, 20mm],
    center = [0mm, 0mm, 20mm],
    normal = [0, 0, 1],
  )
  radius(bend) == 10mm

  ring = circle(
    start = [0mm, 20mm, var 5mm],
    center = [0mm, 20mm, 0mm],
    normal = [1, 0, 0],
    construction = true,
  )
  diameter(ring) == 10mm
  marker = point(at = [var 2mm, var 3mm, var 4mm])
  fixed([marker, [2mm, 3mm, 4mm]])
}
```

Literal coordinates are fixed. `var` coordinates are initial guesses, and
dimensions use `==` just as in a 2D sketch block. A distance includes all
three coordinates. `horizontalDistance`, `verticalDistance`, and
`depthDistance` measure signed world X, Y, and Z offsets, respectively.
`horizontal`, `vertical`, and `depth` align lines with those world axes.

Each circular entity specifies its own fixed, nonzero `normal`, which need
not be axis aligned. The normal determines its plane and counterclockwise
direction. An arc may specify `direction = CW`. Its endpoints stay the same
distance from its center. Tangency supports line/circular and circular/circular
pairs. Angles between spatial lines are unsigned, between 0 and 180 degrees.
Symmetry about a spatial line rotates paired points 180 degrees around it.

The block also supports point coincidence, point-on-line/circle coincidence,
parallel and perpendicular lines, equal lengths, equal radii, line and arc midpoints,
and symmetry. `ORIGIN` means `[0mm, 0mm, 0mm]` inside a 3D block.
Conflicting constraints produce an error; remove the constraint or undo the edit.

In the app, choose **3D sketch**, then create or select a block. Add geometry
with coordinate fields, or choose **Draw in view** and click points on an XY,
XZ, or YZ working plane at the selected offset. Orbit to view the result from
another direction. Arcs use center, start, and end clicks, in that order.
Select geometry or handles in the view or panel, then apply a constraint or
dimension. Coordinate edits preserve fixed versus variable literal coordinates;
edit parameter expressions in the code editor. **Finish sketch** returns to
the modeling toolbar. Changes participate in editor undo and redo.

This experimental implementation renders spatial sketches in the client
viewport. It does not yet create sketch regions or profiles for solid
operations. The existing 2D sketch workflow remains available for those operations.
