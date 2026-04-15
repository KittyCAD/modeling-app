---
title: "patternCircular2d"
subtitle: "Function in std::sketch"
excerpt: "Repeat a 2-dimensional sketch some number of times along a partial or complete circle some specified number of times. Each object may additionally be rotated along the circle, ensuring orientation of the solid with respect to the center of the circle is maintained."
layout: manual
---

Repeat a 2-dimensional sketch some number of times along a partial or complete circle some specified number of times. Each object may additionally be rotated along the circle, ensuring orientation of the solid with respect to the center of the circle is maintained.

```kcl
patternCircular2d(
  @sketches: [Sketch; 1+],
  instances: number(_),
  center?: Point2d,
  arcDegrees?: number(Angle),
  rotateDuplicates?: bool,
  useOriginal?: bool,
): [Sketch; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] | The sketch(es) to duplicate. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center about which to make the pattern. This is a 2D vector. If not given, defaults to `[0, 0]`. | No |
| `arcDegrees` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The arc angle (in degrees) to place the repetitions. Must be greater than 0. | No |
| `rotateDuplicates` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether or not to rotate the duplicates as they are copied. | No |
| `useOriginal` | [`bool`](/docs/kcl-std/types/std-types-bool) | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

[[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+]



