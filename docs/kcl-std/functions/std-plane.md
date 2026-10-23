---
title: "plane"
subtitle: "Function in std"
excerpt: "Create a validated construction plane with an explicit sketch coordinate frame."
layout: manual
---

Create a validated construction plane with an explicit sketch coordinate frame.

```kcl
plane(
  origin?: Point3d,
  xAxis?: [number(_); 3],
  yAxis?: [number(_); 3],
  normal?: [number(_); 3],
  points?: [Point3d; 3],
  a?: number(_),
  b?: number(_),
  c?: number(_),
  d?: number(Length),
): Plane
```

Choose exactly one definition: origin/X/Y axes, origin/normal/X direction,
three ordered points, or equation coefficients/X direction. Directions are
dimensionless. Points and equation offset `d` are lengths.
Three points use the first as origin and the first-to-second direction as X.
The equation form uses `a*x + b*y + c*z + d = 0` and the closest point to the
world origin. Normal/equation forms project the X direction into the plane.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `origin` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | Sketch origin for axes and normal definitions. | No |
| `xAxis` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 3] | X axis, or orientation hint projected into the plane. | No |
| `yAxis` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 3] | Y axis; must be perpendicular to X. | No |
| `normal` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 3] | Plane normal, with direction specifying the positive side. | No |
| `points` | [[`Point3d`](/docs/kcl-std/types/std-types-Point3d); 3] | Three noncollinear points, in origin/X/Y-side order. | No |
| `a` | [`number(_)`](/docs/kcl-std/types/std-types-number) | X coefficient of the plane equation. | No |
| `b` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Y coefficient of the plane equation. | No |
| `c` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Z coefficient of the plane equation. | No |
| `d` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Constant length in the plane equation. | No |

### Returns

[`Plane`](/docs/kcl-std/types/std-types-Plane) - An abstract plane.


### Examples

```kcl
@settings(kclVersion = 2.0)

p = plane(origin = [0mm, 0mm, 20mm], normal = [0, 0, 1], xAxis = [1, 0, 0])
s = sketch(on = p) {
  edge = line(start = [0mm, 0mm], end = [10mm, 0mm])
}

```




