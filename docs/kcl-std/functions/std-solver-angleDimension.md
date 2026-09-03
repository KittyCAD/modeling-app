---
title: "solver::angleDimension"
subtitle: "Function in std::solver"
excerpt: "Constrain the angle in the selected sector between two lines."
layout: manual
---

Constrain the angle in the selected sector between two lines.

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
| `lines` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] | The ordered pair of line segments whose selected angle sector should match the value set with `==`. A line's positive direction runs from its start point to its end point; its negative direction is the reverse. | Yes |
| `sector` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Which counterclockwise sweep about the line intersection to constrain: `1`, first line's positive direction to the second line's positive direction; `2`, second positive to first negative; `3`, first negative to second negative; or `4`, second negative to first positive. | Yes |
| `inverse` | [`bool`](/docs/kcl-std/types/std-types-bool) | Use the counterclockwise sweep from the selected sector's end direction to its start direction. For example, a `20deg` sweep with `inverse = false` becomes `340deg` with `inverse = true`. | No |
| `labelPosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The desired position of the constraint label. | No |


### Examples

```kcl
normalProfile = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  line2 = line(start = [var 0mm, var 0mm], end = [var 2mm, var 3.464mm])
  line3 = line(start = [var 2mm, var 3.464mm], end = [var 4mm, var 0mm])
  coincident([line1.start, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.end])
  angleDimension(lines = [line1, line2], sector = 1, inverse = false) == 60deg
}

inverseProfile = sketch(on = XY) {
  line1 = line(start = [var 7mm, var 0mm], end = [var 11mm, var 0mm])
  line2 = line(start = [var 7mm, var 0mm], end = [var 9mm, var 3.464mm])
  line3 = line(start = [var 9mm, var 3.464mm], end = [var 11mm, var 0mm])
  coincident([line1.start, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.end])
  angleDimension(lines = [line1, line2], sector = 1, inverse = true) == 300deg
}

normalSolid = extrude(
  region(segments = [
    normalProfile.line1,
    normalProfile.line2
  ]),
  length = 2,
)
inverseSolid = extrude(
  region(segments = [
    inverseProfile.line1,
    inverseProfile.line2
  ]),
  length = 2,
)

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


