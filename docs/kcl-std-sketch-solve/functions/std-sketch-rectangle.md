---
title: "rectangle"
subtitle: "Function in std::sketch"
excerpt: "Sketch a rectangle."
layout: manual
---

Sketch a rectangle.

```kcl
rectangle(
  @sketchOrSurface: Sketch | Plane | Face,
  width: number(Length),
  height: number(Length),
  center?: Point2d,
  corner?: Point2d,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

A rectangle can be defined by its width, height, and location. Either the center or corner must be provided, but not both, to specify its location.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | `Sketch | Plane | Face` | Sketch to extend, or plane or surface to sketch on. | Yes |
| `width` | `number(Length)` | Rectangle's width along X axis. | Yes |
| `height` | `number(Length)` | Rectangle's height along Y axis. | Yes |
| `center` | `Point2d` | The center of the rectangle. Either `corner` or `center` is required, but not both. | No |
| `corner` | `Point2d` | The corner of the rectangle. Either `corner` or `center` is required, but not both. This will be the corner which is most negative on both X and Y axes. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



