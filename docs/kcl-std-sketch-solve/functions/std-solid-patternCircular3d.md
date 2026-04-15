---
title: "patternCircular3d"
subtitle: "Function in std::solid"
excerpt: "Repeat a 3-dimensional solid some number of times along a partial or complete circle some specified number of times. Each object may additionally be rotated along the circle, ensuring orientation of the solid with respect to the center of the circle is maintained."
layout: manual
---

Repeat a 3-dimensional solid some number of times along a partial or complete circle some specified number of times. Each object may additionally be rotated along the circle, ensuring orientation of the solid with respect to the center of the circle is maintained.

```kcl
patternCircular3d(
  @solids: [Solid; 1+],
  instances: number(_),
  axis: Axis3d | Point3d,
  center?: Point3d,
  arcDegrees?: number(deg),
  rotateDuplicates?: bool,
  useOriginal?: bool,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The solid(s) to pattern. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The axis of the pattern. A 3D vector. | Yes |
| `center` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The center about which to make the pattern. This is a 3D vector. If not given, defaults to `[0, 0, 0]`. | No |
| `arcDegrees` | [`number(deg)`](/docs/kcl-std/types/std-types-number) | "The arc angle to place the repetitions. Must be greater than 0. | No |
| `rotateDuplicates` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether or not to rotate the duplicates as they are copied. | No |
| `useOriginal` | [`bool`](/docs/kcl-std/types/std-types-bool) | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]



