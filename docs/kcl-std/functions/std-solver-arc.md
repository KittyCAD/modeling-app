---
title: "solver::arc"
subtitle: "Function in std::solver"
excerpt: "Create a circular arc. The arc segment always sweeps counterclockwise from start to end. To change direction, swap the start and end points."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a circular arc. The arc segment always sweeps counterclockwise from start to end. To change direction, swap the start and end points.

```kcl
solver::arc(
  start: Point2d,
  end: Point2d,
  center: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The point where the arc begins. | Yes |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The point where the arc ends. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the circle the arc lies on. | Yes |
| `construction` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.


### Examples

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = XY) {
  base = line(start = [var -5mm, var 0mm], end = [var 5mm, var 0mm])
  top = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var 5mm])
  coincident([base.end, top.start])
  coincident([base.start, top.end])
}

solid = extrude(region(point = [0mm, 2mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::arc function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-arc0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-arc0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


