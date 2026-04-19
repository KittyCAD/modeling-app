---
title: "solver::equalRadius"
subtitle: "Function in std::solver"
excerpt: "Constrain circular segments to have equal radius."
layout: manual
---

Constrain circular segments to have equal radius.

```kcl
solver::equalRadius(@input: [Segment; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2+] | Two or more arc or circle segments that should share the same radius. | Yes |


### Examples

```kcl
sketch1 = sketch(on = XY) {
  circle1 = circle(start = [var -2mm, var 0mm], center = [var -6mm, var 0mm])
  circle2 = circle(start = [var 10mm, var 0mm], center = [var 6mm, var 0mm])
  equalRadius([circle1, circle2])
  tangent([circle1, circle2])
}

solid1 = extrude(region(point = sketch1.circle1.center, sketch = sketch1), length = 2)
solid2 = extrude(region(point = sketch1.circle2.center, sketch = sketch1), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::equalRadius function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-equalRadius0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-equalRadius0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


