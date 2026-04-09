---
title: "solver::coincident"
subtitle: "Function in std::solver"
excerpt: "Constrain points, or a point and a segment to be coincident."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain points, or a point and a segment to be coincident.

```kcl
solver::coincident(@points: [Segment | Point2d; 2])
```

Supports two points, or one point and one segment (line/arc).
A single [`Point2d`](/docs/kcl-std/types/std-types-Point2d) (e.g. `[1mm, 2.5mm]`) can be used to pin a point to a fixed position.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [[`Segment`](/docs/kcl-std/types/std-types-Segment) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d); 2] | Two points, or one point and one line/arc segment, that should occupy the same location. | Yes |


### Examples

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  edge2 = line(start = [var 4mm, var 0mm], end = [var 4mm, var 3mm])
  edge3 = line(start = [var 4mm, var 3mm], end = [var 0mm, var 3mm])
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
  alt="Example showing a rendered KCL program that uses the solver::coincident function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-coincident0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-coincident0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


