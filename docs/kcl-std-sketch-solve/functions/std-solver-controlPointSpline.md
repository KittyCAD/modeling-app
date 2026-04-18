---
title: "solver::controlPointSpline"
subtitle: "Function in std::solver"
excerpt: "Create a control-point spline in a sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a control-point spline in a sketch.

```kcl
solver::controlPointSpline(
  points: [Point2d; 3+],
  construction?: bool,
): Segment
```

The spline is defined by a control polygon. The curve generally passes
through the first and last control points and is shaped by the interior
control points.


The minimum input is three control points. The current degree policy is:
- 3 control points -> degree 2
- 4 or more control points -> degree 3

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | `[Point2d; 3+]` | The ordered control points of the spline's control polygon. | Yes |
| `construction` | `bool` | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

`Segment` - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.


### Examples

```kcl
profile = sketch(on = XY) {
  spline1 = controlPointSpline(points = [
    [var 0mm, var 0mm],
    [var 20mm, var 30mm],
    [var 40mm, var 0mm],
    [var 60mm, var 20mm]
  ])
}

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::controlPointSpline function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-controlPointSpline0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-controlPointSpline0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


