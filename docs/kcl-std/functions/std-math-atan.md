---
title: "atan"
subtitle: "Function in std::math"
excerpt: "Compute the arctangent of a number."
layout: manual
---

Compute the arctangent of a number.

```kcl
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = atan(1.25), length = 20)
  |> yLine(endAbsolute = 0)
  |> close()

extrude001 = extrude(sketch001, length = 5)

```

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number(rad)`](/docs/kcl-std/types/std-types-number) - A number.

### Description

Consider using `atan2()` instead for the true inverse of tangent.

### Function signature

```kcl
atan(@num: number(_)): number(rad)
```

### Examples

```kcl
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = atan(1.25), length = 20)
  |> yLine(endAbsolute = 0)
  |> close()

extrude001 = extrude(sketch001, length = 5)

```



