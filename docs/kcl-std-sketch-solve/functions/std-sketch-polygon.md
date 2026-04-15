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
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | `Sketch | Plane | Face` | Plane or surface to sketch on. | Yes |
| `radius` | `number(Length)` | The radius of the polygon. | Yes |
| `numSides` | `number(_)` | The number of sides in the polygon. | Yes |
| `center` | `Point2d` | The center point of the polygon. If not given, defaults to `[0, 0]`. | No |
| `inscribed` | `bool` | Whether the polygon is inscribed (true, the default) or circumscribed (false) about a circle with the specified radius. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



