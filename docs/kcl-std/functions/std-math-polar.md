---
title: "polar"
subtitle: "Function in std::math"
excerpt: "Convert polar/sphere (azimuth, elevation, distance) coordinates to cartesian (x/y/z grid) coordinates."
layout: manual
---

Convert polar/sphere (azimuth, elevation, distance) coordinates to cartesian (x/y/z grid) coordinates.

```kcl
polar(
  angle: number(rad),
  length: number(Length),
): Point2d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `angle` | [`number(rad)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`Point2d`](/docs/kcl-std/types/std-types-Point2d) - A point in two dimensional space.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = polar(angle = 30deg, length = 5), tag = $thing)
  |> line(end = [0, 5])
  |> line(end = [segEndX(thing), 0])
  |> line(end = [-20, 10])
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-polar0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-polar0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


