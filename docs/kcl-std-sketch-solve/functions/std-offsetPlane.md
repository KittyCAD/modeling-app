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
| `plane` | `Plane` | The plane (e.g. `XY`) which this new plane is created from. | Yes |
| `offset` | `number(Length)` | Distance from the standard plane this new plane will be created at. | Yes |

### Returns

`Plane` - An abstract plane.



