---
title: "solver::vertical"
subtitle: "Function in std::solver"
excerpt: "Constrain a line to be vertical."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain a line to be vertical.

```kcl
solver::vertical(@input: Segment)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The line segment that should remain vertical. | Yes |


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
  vertical(edge2)
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::vertical function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-vertical0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-vertical0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


