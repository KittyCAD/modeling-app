---
title: "involuteCircular"
subtitle: "Function in std::sketch"
excerpt: "Extend the current sketch with a new involute circular curve."
layout: manual
---

Extend the current sketch with a new involute circular curve.

```kcl
involuteCircular(
  @sketch: Sketch,
  angle: number(Angle),
  startRadius?: number(Length),
  endRadius?: number(Length),
  startDiameter?: number(Length),
  endDiameter?: number(Length),
  reverse?: bool,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve. The sketch-solve version
of involute circular is still under development.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `angle` | `number(Angle)` | The angle to rotate the involute by. A value of zero will produce a curve with a tangent along the x-axis at the start point of the curve. | Yes |
| `startRadius` | `number(Length)` | The involute is described between two circles, startRadius is the radius of the inner circle. Either `startRadius` or `startDiameter` must be given (but not both). | No |
| `endRadius` | `number(Length)` | The involute is described between two circles, endRadius is the radius of the outer circle. Either `endRadius` or `endDiameter` must be given (but not both). | No |
| `startDiameter` | `number(Length)` | The involute is described between two circles, startDiameter describes the inner circle. Either `startRadius` or `startDiameter` must be given (but not both). | No |
| `endDiameter` | `number(Length)` | The involute is described between two circles, endDiameter describes the outer circle. Either `endRadius` or `endDiameter` must be given (but not both). | No |
| `reverse` | `bool` | If reverse is true, the segment will start from the end of the involute, otherwise it will start from that start. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this line. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



