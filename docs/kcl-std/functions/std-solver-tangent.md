---
title: "solver::tangent"
subtitle: "Function in std::solver"
excerpt: "Constrain two segments to be tangent."
layout: manual
---

Constrain two segments to be tangent.

```kcl
solver::tangent(@input: [Segment; 2])
```

Supported input type pairs (unordered):
- `Line` / `Circle`
- `Line` / `CircularArc`
- `Circle` / `Circle`
- `Circle` / `CircularArc`
- `CircularArc` / `CircularArc`
- `controlPointSpline` / `Line`
- `controlPointSpline` / `Circle`
- `controlPointSpline` / `CircularArc`

For `controlPointSpline`, tangent is solved against the spline itself, not just the
first or last control-polygon edge. The solver introduces a hidden spline parameter
and finds the tangent point along the curve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] | Two supported line/arc/circle segments that should touch without crossing. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  guideArc = arc(start = [var 0mm, var 2mm], end = [var 2mm, var 0mm], center = [var 2mm, var 2mm])
  tangentLine = line(start = [var 0mm, var 2mm], end = [var 0mm, var 4mm])
  tangent([tangentLine, guideArc])
  coincident([tangentLine.start, guideArc.start])
  line1 = line(start = [var 0mm, var 4mm], end = [var 2mm, var 0mm])
  coincident([guideArc.end, line1.end])
  coincident([tangentLine.end, line1.start])
}

solid = extrude(region(point = [1mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::tangent function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-tangent0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-tangent0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


