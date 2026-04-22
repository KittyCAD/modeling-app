---
title: "solver::circle"
subtitle: "Function in std::solver"
excerpt: "Create a circle in a sketch. The circle segment always has a starting point and sweeps counterclockwise from it."
layout: manual
---

Create a circle in a sketch. The circle segment always has a starting point and sweeps counterclockwise from it.

```kcl
solver::circle(
  start: Point2d,
  center: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point on the circle that sets where the circle starts. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the circle. | Yes |
| `construction` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.


### Examples

```kcl
profile = sketch(on = XY) {
  circle1 = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm], construction = true)
  edge1 = line(start = [var -3mm, var -2mm], end = [var 3mm, var -2mm])
  edge2 = line(start = [var 3mm, var -2mm], end = [var 3mm, var 2mm])
  edge3 = line(start = [var 3mm, var 2mm], end = [var -3mm, var 2mm])
  edge4 = line(start = [var -3mm, var 2mm], end = [var -3mm, var -2mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}

solid = extrude(region(point = [0mm, 0mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::circle function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-circle0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-circle0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


