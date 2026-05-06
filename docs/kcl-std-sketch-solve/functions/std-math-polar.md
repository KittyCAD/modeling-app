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
| `angle` | `number(rad)` | A number. | Yes |
| `length` | `number(Length)` | A number. | Yes |

### Returns

`Point2d` - A point in two dimensional space.



