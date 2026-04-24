---
title: "solver::midpoint"
subtitle: "Function in std::solver"
excerpt: "Constrain a point to lie at the midpoint of a line segment."
layout: manual
---

Constrain a point to lie at the midpoint of a line segment.

```kcl
solver::midpoint(
  @input: Segment,
  line: Segment,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The point to place at the midpoint. | Yes |
| `line` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The line whose midpoint is constrained. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  edge = line(start = [var 0mm, var 0mm], end = [var 6mm, var 4mm])
  center = point(at = [var 1mm, var 1mm])
  midpoint(center, line = edge)
}

solid = extrude(region(point = [3mm, 2mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::midpoint function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-midpoint0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-midpoint0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


