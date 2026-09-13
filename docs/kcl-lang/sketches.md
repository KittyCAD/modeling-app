---
title: "Sketch Blocks and Constraints"
excerpt: "Write constrained, editable sketches with KCL sketch blocks."
layout: manual
---

KCL sketch blocks define 2D geometry and the relationships that control it.
Start a block on a base plane or supported face, add sketch geometry inside the
braces, then apply constraints to express design intent.

```kcl
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
