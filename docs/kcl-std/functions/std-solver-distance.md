---
title: "solver::distance"
subtitle: "Function in std::solver"
excerpt: "Constrain the distance between two sketch entities."
layout: manual
---

Constrain the distance between two sketch entities.

```kcl
solver::distance(
  @points: [Segment | Point2d; 2],
  labelPosition?: Point2d,
)
```

The distance is always non-negative, and the order of the two entities
does not matter: `distance([a, b]) == 5mm` and `distance([b, a]) == 5mm`
are the same constraint. This differs from `horizontalDistance` and
`verticalDistance`, which are signed and order-sensitive.

Supported entity pairs (in either order):

- Two points: the straight-line distance between them.
- Point and line: the perpendicular distance from the point to the
  infinite line through the line segment.
- Two lines: constrains the lines to be parallel and separated by the
  given perpendicular distance.
- Point and circle: the gap between the point and the nearest point on
  the circle's perimeter, with the point kept outside the circle.
- Line and circle: the gap between the circle's perimeter and the
  infinite line through the line segment, with the circle kept to one
  side of the line.
- Two circles: the gap between the two perimeters, with each circle kept
  outside the other.

A point may be `ORIGIN`, and arcs are treated as the full circle through
them.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [[`Segment`](/docs/kcl-std/types/std-types-Segment) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d); 2] | Two sketch entities, or one sketch entity and `ORIGIN`, whose separation should match the value set with `==`. The order of the entities does not matter. | Yes |
| `labelPosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Optional position for the displayed constraint label in the sketch's local 2D coordinate system. | No |


### Examples

```kcl
profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  edge2 = line(start = [var 4mm, var 0mm], end = [var 4mm, var 3mm])
  edge3 = line(start = [var 4mm, var 3mm], end = [var 0mm, var 3mm])
  edge4 = line(start = [var 0mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  distance([edge1.start, edge2.end]) == 5mm
}

solid = extrude(region(segments = [profile.edge1, profile.edge2]), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::distance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-distance0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-distance0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


