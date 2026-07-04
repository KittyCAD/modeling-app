---
title: "solver::angleDimension"
subtitle: "Function in std::solver"
excerpt: "Constrain a specific angle dimension sector between two lines."
layout: manual
---

Constrain a specific angle dimension sector between two lines.

```kcl
solver::angleDimension(
  lines: [Segment; 2],
  sector: number(_),
  inverse?: bool,
  labelPosition?: Point2d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `lines` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] | The two line segments whose selected angle sector should match the value set with `==`. | Yes |
| `sector` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Which of the four angle sectors to constrain, numbered around the line intersection. | Yes |
| `inverse` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether to constrain the inverse of the selected sector. | No |
| `labelPosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The desired position of the constraint label. | No |


### Examples

```kcl
profile = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  line2 = line(start = [var 0mm, var 0mm], end = [var 2mm, var 3.464mm])
  angleDimension(lines = [line1, line2], sector = 1) == 60deg
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::angleDimension function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-angleDimension0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-angleDimension0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


