---
title: "solver::midpoint"
subtitle: "Function in std::solver"
excerpt: "Constrain a point to lie at the midpoint of a line segment or circular arc."
layout: manual
---

Constrain a point to lie at the midpoint of a line segment or circular arc.

```kcl
solver::midpoint(
  @input: Segment,
  point: Segment,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The line or circular arc whose midpoint is constrained. | Yes |
| `point` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The point to place at the midpoint. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 3mm])
  coincident([line1.start, ORIGIN])

  arc1 = arc(start = [var 2mm, var 1mm], end = [var -3mm, var -2mm], center = [var 0mm, var 0mm])
  coincident([arc1.center, line1.start])
  coincident([arc1.start, line1])
  midpoint(line1, point = arc1.start)

  line2 = line(start = [var -1mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([line2.start, arc1])
  coincident([line2.end, arc1.center])
  midpoint(arc1, point = line2.start)
}
solid = extrude(region(point = [1, 2], sketch = profile), length = 5)

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


