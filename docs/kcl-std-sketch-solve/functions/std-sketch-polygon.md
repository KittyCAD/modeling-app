---
title: "polygon"
subtitle: "Function in std::sketch"
excerpt: "Create a regular polygon with the specified number of sides that is either inscribed or circumscribed around a circle of the specified radius."
layout: manual
---

Create a regular polygon with the specified number of sides that is either inscribed or circumscribed around a circle of the specified radius.

```kcl
polygon(
  @sketchOrSurface: Sketch | Plane | Face,
  radius: number(Length),
  numSides: number(_),
  center?: Point2d,
  inscribed?: bool,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | Plane or surface to sketch on. | Yes |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The radius of the polygon. | Yes |
| `numSides` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of sides in the polygon. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center point of the polygon. If not given, defaults to `[0, 0]`. | No |
| `inscribed` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether the polygon is inscribed (true, the default) or circumscribed (false) about a circle with the specified radius. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



