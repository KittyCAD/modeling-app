---
title: "elliptic"
subtitle: "Function in std::sketch"
excerpt: "Add an elliptic section to an existing sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Add an elliptic section to an existing sketch.

```kcl
elliptic(
  @sketch: Sketch,
  center: Point2d,
  angleStart: number(Angle),
  angleEnd: number(Angle),
  minorRadius: number(Length),
  majorRadius?: number(Length),
  majorAxis?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve. The sketch-solve version
of elliptic is still under development.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `center` | `Point2d` | The center of the ellipse. | Yes |
| `angleStart` | `number(Angle)` | Where along the ellptic should this segment start? | Yes |
| `angleEnd` | `number(Angle)` | Where along the ellptic should this segment end? | Yes |
| `minorRadius` | `number(Length)` | The minor radius, b, of the elliptic equation x^2 / a^2 + y^2 / b^2 = 1. | Yes |
| `majorRadius` | `number(Length)` | The major radius, a, of the elliptic equation x^2 / a^2 + y^2 / b^2 = 1. Equivalent to majorAxis = [majorRadius, 0]. | No |
| `majorAxis` | `Point2d` | The major axis of the elliptic. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this arc. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



