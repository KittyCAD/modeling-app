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
[sketch-solve](/docs/kcl-std/modules/std-solver).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | Plane or surface to sketch on. | Yes |
| `p1` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | 1st point to derive the circle. | Yes |
| `p2` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | 2nd point to derive the circle. | Yes |
| `p3` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | 3rd point to derive the circle. | Yes |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Identifier for the circle to reference elsewhere. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



