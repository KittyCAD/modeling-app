---
title: "offsetPlane"
subtitle: "Function in std"
excerpt: "Offset a plane by a distance along its normal."
layout: manual
---

Offset a plane by a distance along its normal.

```kcl
offsetPlane(
  @plane: Plane,
  offset: number(Length),
): Plane
```

For example, if you offset the `XZ` plane by 10, the new plane will be parallel to the `XZ`
plane and 10 units away from it.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `plane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane (e.g. `XY`) which this new plane is created from. | Yes |
| `offset` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance from the standard plane this new plane will be created at. | Yes |

### Returns

[`Plane`](/docs/kcl-std/types/std-types-Plane) - An abstract plane.



