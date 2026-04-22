---
title: "bezierCurve"
subtitle: "Function in std::sketch"
excerpt: "Draw a smooth, continuous, curved line segment from the current origin to the desired (x, y), using a number of control points to shape the curve's shape."
layout: manual
---

Draw a smooth, continuous, curved line segment from the current origin to the desired (x, y), using a number of control points to shape the curve's shape.

```kcl
bezierCurve(
  @sketch: Sketch,
  control1?: Point2d,
  control2?: Point2d,
  end?: Point2d,
  control1Absolute?: Point2d,
  control2Absolute?: Point2d,
  endAbsolute?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve. The sketch-solve version
of bezier curve is still under development.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `control1` | `Point2d` | First control point for the cubic. | No |
| `control2` | `Point2d` | Second control point for the cubic. | No |
| `end` | `Point2d` | How far away (along the X and Y axes) should this line go? | No |
| `control1Absolute` | `Point2d` | First control point for the cubic. Absolute point. | No |
| `control2Absolute` | `Point2d` | Second control point for the cubic. Absolute point. | No |
| `endAbsolute` | `Point2d` | Coordinate on the plane at which this line should end. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this line. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



