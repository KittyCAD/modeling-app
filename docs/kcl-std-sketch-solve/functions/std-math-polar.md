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



