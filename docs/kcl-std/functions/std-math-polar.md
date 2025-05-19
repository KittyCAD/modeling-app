---
title: "polar"
subtitle: "Function in std::math"
excerpt: ""
layout: manual
---



```kcl
polar(
  angle: number(rad),
  length: number(Length),
): Point2d
```

Convert polar/sphere (azimuth, elevation, distance) coordinates to
cartesian (x/y/z grid) coordinates.

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
  |> line(end = polar(angle = 30, length = 5), tag = $thing)
  |> line(end = [0, 5])
  |> line(end = [segEndX(thing), 0])
  |> line(end = [-20, 10])
  |> close()

example = extrude(exampleSketch, length = 5)
```



