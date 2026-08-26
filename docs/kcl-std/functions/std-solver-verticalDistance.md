---
title: "solver::verticalDistance"
subtitle: "Function in std::solver"
excerpt: "Constrain the vertical distance between two points."
layout: manual
---

Constrain the vertical distance between two points.

```kcl
solver::verticalDistance(
  @points: [Segment | Point2d; 2],
  labelPosition?: Point2d,
)
```

The distance is signed, so the order of the points matters: the value set
with `==` equals the second point's Y coordinate minus the first point's
Y coordinate. A positive value places the second point at a greater Y
than the first, and swapping the points negates the sign. For example,
`verticalDistance([ORIGIN, point]) == 5mm` places `point` at Y = 5mm,
while `verticalDistance([point, ORIGIN]) == 5mm` places it at Y = -5mm.
Negative values are valid: if the second point is below the first, use a
negative value (or swap the points and use the corresponding positive value).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [[`Segment`](/docs/kcl-std/types/std-types-Segment) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d); 2] | Two sketch points, or one sketch point and `ORIGIN`. The value set with `==` equals the second point's Y coordinate minus the first point's Y coordinate, so the order of the points determines the sign. | Yes |
| `labelPosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Optional position for the displayed constraint label in the sketch's local 2D coordinate system. | No |


### Examples

```kcl
profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  edge2 = line(start = [var 4mm, var 0mm], end = [var 4mm, var 5mm])
  edge3 = line(start = [var 4mm, var 5mm], end = [var 0mm, var 5mm])
  edge4 = line(start = [var 0mm, var 5mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  verticalDistance([edge1.start, edge4.start]) == 5mm
}

solid = extrude(region(segments = [profile.edge1, profile.edge2]), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::verticalDistance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-verticalDistance0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-verticalDistance0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


