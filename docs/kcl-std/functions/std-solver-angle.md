---
title: "solver::angle"
subtitle: "Function in std::solver"
excerpt: "Constrain lines to meet at a given angle."
layout: manual
---

**WARNING:** This function is deprecated as of KCL 2.0.

Constrain lines to meet at a given angle.

```kcl
solver::angle(
  @input: [Segment; 2],
  labelPosition?: Point2d,
)
```

Deprecated as of KCL 2.0. Use `angleDimension` for new angle constraints.

The angle is measured counterclockwise from the first line to the second
line, modulo 180 degrees, so the order of the lines matters:
`angle([a, b]) == 30deg` is equivalent to `angle([b, a]) == 150deg`.
Because the angle is measured modulo 180 degrees, it does not matter
which end of each line segment is its start or end.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] | The two line segments whose relative angle should match the value set with `==`, measured counterclockwise from the first line to the second, modulo 180 degrees. The order of the lines matters. | Yes |
| `labelPosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The desired position of the constraint label. | No |


### Examples

```kcl
profile = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  line2 = line(start = [var 0mm, var 0mm], end = [var 2mm, var 3.464mm])
  line3 = line(start = [var 2mm, var 3.464mm], end = [var 4mm, var 0mm])
  coincident([line1.start, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.end])
  angle([line1, line2]) == 60deg
}

solid = extrude(region(segments = [profile.line1, profile.line2]), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::angle function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-angle0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-angle0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


