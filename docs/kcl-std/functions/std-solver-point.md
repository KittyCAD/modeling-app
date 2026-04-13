---
title: "solver::point"
subtitle: "Function in std::solver"
excerpt: "Create a point in a sketch."
layout: manual
---

Create a point in a sketch.

```kcl
solver::point(at: Point2d): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `at` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The point's position in the sketch's local 2D coordinate system. | Yes |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.


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
  inside = point(at = [var 1mm, var 1mm])
}

solid = extrude(region(point = profile.inside), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::point function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-point0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-point0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


