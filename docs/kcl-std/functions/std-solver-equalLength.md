---
title: "solver::equalLength"
subtitle: "Function in std::solver"
excerpt: "Constrain lines to have equal length."
layout: manual
---

Constrain lines to have equal length.

```kcl
solver::equalLength(@lines: [Segment; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `lines` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2+] | Two or more line segments that should all share the same length. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  base = line(start = [var -3mm, var 0mm], end = [var 3mm, var 0mm])
  side1 = line(start = [var 3mm, var 0mm], end = [var 0mm, var 4mm])
  side2 = line(start = [var 0mm, var 4mm], end = [var -3mm, var 0mm])
  coincident([base.end, side1.start])
  coincident([side1.end, side2.start])
  coincident([side2.end, base.start])
  horizontal(base)
  equalLength([side1, side2])
}

solid = extrude(region(point = [0mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::equalLength function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-equalLength0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-equalLength0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


