---
title: "hyperbolic"
subtitle: "Function in std::sketch"
excerpt: "Add a hyperbolic section to an existing sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Add a hyperbolic section to an existing sketch.

```kcl
hyperbolic(
  @sketch: Sketch,
  semiMajor: number(Length),
  semiMinor: number(Length),
  interiorAbsolute?: Point2d,
  endAbsolute?: Point2d,
  interior?: Point2d,
  end?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve. The sketch-solve version
of hyperbolic is still under development.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `semiMajor` | `number(Length)` | The semi major value, a, of the hyperbolic equation x^2 / a ^ 2 - y^2 / b^2 = 1. | Yes |
| `semiMinor` | `number(Length)` | The semi minor value, b, of the hyperbolic equation x^2 / a ^ 2 - y^2 / b^2 = 1. | Yes |
| `interiorAbsolute` | `Point2d` | Any point between the segment's start and end. Requires `endAbsolute`. Incompatible with `interior` or `end`. | No |
| `endAbsolute` | `Point2d` | Where should this segment end? Requires `interiorAbsolute`. Incompatible with `interior` or `end`. | No |
| `interior` | `Point2d` | Any point between the segment's start and end. This point is relative to the start point. Requires `end`. Incompatible with `interiorAbsolute` or `endAbsolute`. | No |
| `end` | `Point2d` | Where should this segment end? This point is relative to the start point. Requires `interior`. Incompatible with `interiorAbsolute` or `endAbsolute`. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this arc. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



