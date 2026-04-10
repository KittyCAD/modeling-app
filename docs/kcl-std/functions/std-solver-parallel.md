---
title: "solver::parallel"
subtitle: "Function in std::solver"
excerpt: "Constrain lines to be parallel."
layout: manual
---

Constrain lines to be parallel.

```kcl
solver::parallel(@input: [Segment; 2+])
```

Currently limited to two lines.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2+] | The line segments that should remain parallel. Currently limited to two lines. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  base = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  right = line(start = [var 5mm, var 0mm], end = [var 4mm, var 3mm])
  top = line(start = [var 4mm, var 3mm], end = [var 1mm, var 3mm])
  left = line(start = [var 1mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([base.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, base.start])
  parallel([base, top])
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::parallel function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-parallel0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-parallel0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


