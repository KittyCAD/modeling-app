---
title: "solver::radius"
subtitle: "Function in std::solver"
excerpt: "Constrain the radius of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point."
layout: manual
---

Constrain the radius of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point.

```kcl
solver::radius(
  @points: Segment,
  labelPosition?: Point2d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The arc or circle segment whose radius should match the value set with `==`. | Yes |
| `labelPosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Optional position for the displayed constraint label in the sketch's local 2D coordinate system. | No |


### Examples

```kcl
profile = sketch(on = XY) {
  base = line(start = [var -4mm, var 0mm], end = [var 4mm, var 0mm])
  arch = arc(start = [var 4mm, var 0mm], end = [var -4mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([base.end, arch.start])
  coincident([base.start, arch.end])
  radius(arch) == 4mm
}

solid = extrude(region(point = [0mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::radius function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-radius0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-radius0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


