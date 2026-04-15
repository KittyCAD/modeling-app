---
title: "circle"
subtitle: "Function in std::sketch"
excerpt: "Construct a 2-dimensional circle, of the specified radius, centered at the provided (x, y) origin point."
layout: manual
---

Construct a 2-dimensional circle, of the specified radius, centered at the provided (x, y) origin point.

```kcl
circle(
  @sketchOrSurface: Sketch | Plane | Face,
  center?: Point2d,
  radius?: number(Length),
  diameter?: number(Length),
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | `Sketch | Plane | Face` | Sketch to extend, or plane or surface to sketch on. | Yes |
| `center` | `Point2d` | The center of the circle. If not given, defaults to `[0, 0]`. | No |
| `radius` | `number(Length)` | The radius of the circle. Incompatible with `diameter`. | No |
| `diameter` | `number(Length)` | The diameter of the circle. Incompatible with `radius`. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this circle. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



