---
title: "tangentialArc"
subtitle: "Function in std::sketch"
excerpt: "Starting at the current sketch's origin, draw a curved line segment along some part of an imaginary circle until it reaches the desired (x, y) coordinates."
layout: manual
---

Starting at the current sketch's origin, draw a curved line segment along some part of an imaginary circle until it reaches the desired (x, y) coordinates.

```kcl
tangentialArc(
  @sketch: Sketch,
  endAbsolute?: Point2d,
  end?: Point2d,
  radius?: number(Length),
  diameter?: number(Length),
  angle?: number(Angle),
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

When using radius and angle, draw a curved line segment along part of an
imaginary circle. The arc is constructed such that the last line segment is
placed tangent to the imaginary circle of the specified radius. The
resulting arc is the segment of the imaginary circle from that tangent point
for 'angle' degrees along the imaginary circle.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `endAbsolute` | `Point2d` | Which absolute point should this arc go to? Incompatible with `end`, `radius`, and `offset`. | No |
| `end` | `Point2d` | How far away (along the X and Y axes) should this arc go? Incompatible with `endAbsolute`, `radius`, and `offset`. | No |
| `radius` | `number(Length)` | Radius of the imaginary circle. `angle` must be given. Incompatible with `end` and `endAbsolute` and `diameter`. | No |
| `diameter` | `number(Length)` | Diameter of the imaginary circle. `angle` must be given. Incompatible with `end` and `endAbsolute` and `radius`. | No |
| `angle` | `number(Angle)` | Offset of the arc. `radius` must be given. Incompatible with `end` and `endAbsolute`. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this arc. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



