---
title: "patternLinear3d"
subtitle: "Function in std::solid"
excerpt: "Repeat a 3-dimensional solid along a linear path, with a dynamic amount of distance between each repetition, some specified number of times."
layout: manual
---

Repeat a 3-dimensional solid along a linear path, with a dynamic amount of distance between each repetition, some specified number of times.

```kcl
patternLinear3d(
  @solids: [Solid; 1+],
  instances: number(_),
  distance: number(Length),
  axis: Axis3d | Point3d,
  useOriginal?: bool,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The solid(s) to duplicate. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `distance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance between each repetition. Also known as 'spacing'. | Yes |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The axis of the pattern. A 3D vector. | Yes |
| `useOriginal` | [`bool`](/docs/kcl-std/types/std-types-bool) | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]



