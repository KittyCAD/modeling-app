---
title: "solver::line"
subtitle: "Function in std::solver"
excerpt: "Create a straight line segment in a sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a straight line segment in a sketch.

```kcl
solver::line(
  start: Point2d,
  end: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The segment's start point in sketch coordinates. | Yes |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The segment's end point in sketch coordinates. | Yes |
| `construction` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.


### Examples

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  edge2 = line(start = [var 5mm, var 0mm], end = [var 5mm, var 3mm])
  edge3 = line(start = [var 5mm, var 3mm], end = [var 0mm, var 3mm])
  edge4 = line(start = [var 0mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::line function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-line0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-line0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


