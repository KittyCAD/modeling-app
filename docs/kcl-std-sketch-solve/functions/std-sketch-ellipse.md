---
title: "ellipse"
subtitle: "Function in std::sketch"
excerpt: "Construct a 2-dimensional ellipse, of the specified major/minor radius, centered at the provided (x, y) point."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Construct a 2-dimensional ellipse, of the specified major/minor radius, centered at the provided (x, y) point.

```kcl
ellipse(
  @sketchOrSurface: Sketch | Plane | Face,
  minorRadius: number(Length),
  center?: Point2d,
  majorRadius?: number(Length),
  majorAxis?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver). The sketch-solve version
of ellipse is still under development.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | Sketch to extend, or plane or surface to sketch on. | Yes |
| `minorRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The minor radius of the ellipse. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the ellipse. If not given, defaults to `[0, 0]`. | No |
| `majorRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The major radius of the ellipse. Equivalent to majorAxis = [majorRadius, 0]. | No |
| `majorAxis` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The major axis of the ellipse. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this ellipse. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



