---
title: "arc"
subtitle: "Function in std::sketch"
excerpt: "Draw a curved line segment along an imaginary circle."
layout: manual
---

Draw a curved line segment along an imaginary circle.

```kcl
arc(
  @sketch: Sketch,
  angleStart?: number(Angle),
  angleEnd?: number(Angle),
  radius?: number(Length),
  diameter?: number(Length),
  interiorAbsolute?: Point2d,
  endAbsolute?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

The arc is constructed such that the current position of the sketch is
placed along an imaginary circle of the specified radius, at angleStart
degrees. The resulting arc is the segment of the imaginary circle from
that origin point to angleEnd, radius away from the center of the imaginary
circle.

Unless this makes a lot of sense and feels like what you're looking
for to construct your shape, you're likely looking for tangentialArc.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `angleStart` | `number(Angle)` | Where along the circle should this arc start? | No |
| `angleEnd` | `number(Angle)` | Where along the circle should this arc end? | No |
| `radius` | `number(Length)` | How large should the circle be? Incompatible with `diameter`. | No |
| `diameter` | `number(Length)` | How large should the circle be? Incompatible with `radius`. | No |
| `interiorAbsolute` | `Point2d` | Any point between the arc's start and end? Requires `endAbsolute`. Incompatible with `angleStart` or `angleEnd`. | No |
| `endAbsolute` | `Point2d` | Where should this arc end? Requires `interiorAbsolute`. Incompatible with `angleStart` or `angleEnd`. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this arc. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



