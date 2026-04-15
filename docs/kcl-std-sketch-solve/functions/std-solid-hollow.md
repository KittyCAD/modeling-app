---
title: "hollow"
subtitle: "Function in std::solid"
excerpt: "Make the inside of a 3D object hollow."
layout: manual
---

Make the inside of a 3D object hollow.

```kcl
hollow(
  @solid: Solid,
  thickness: number(Length),
): Solid
```

Remove volume from a 3-dimensional shape such that a wall of the
provided thickness remains around the exterior of the shape.
By default, it'll look visually the same, but you can see the difference
if you use `appearance` to make it transparent, or cut it open with
a `subtract`.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Which solid to hollow out | Yes |
| `thickness` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The thickness of the remaining shell | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.



