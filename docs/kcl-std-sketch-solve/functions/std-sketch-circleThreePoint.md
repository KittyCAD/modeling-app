---
title: "circleThreePoint"
subtitle: "Function in std::sketch"
excerpt: "Construct a circle derived from 3 points."
layout: manual
---

Construct a circle derived from 3 points.

```kcl
circleThreePoint(
  @sketchOrSurface: Sketch | Plane | Face,
  p1: Point2d,
  p2: Point2d,
  p3: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | `Sketch | Plane | Face` | Plane or surface to sketch on. | Yes |
| `p1` | `Point2d` | 1st point to derive the circle. | Yes |
| `p2` | `Point2d` | 2nd point to derive the circle. | Yes |
| `p3` | `Point2d` | 3rd point to derive the circle. | Yes |
| `tag` | `TagDecl` | Identifier for the circle to reference elsewhere. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



