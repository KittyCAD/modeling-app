---
title: "parabolic"
subtitle: "Function in std::sketch"
excerpt: "Add a parabolic segment to an existing sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Add a parabolic segment to an existing sketch.

```kcl
parabolic(
  @sketch: Sketch,
  end: Point2d,
  endAbsolute?: Point2d,
  coefficients?: [number; 3],
  interior?: Point2d,
  interiorAbsolute?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver). The sketch-solve version
of parabolic is still under development.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should the path end? Relative to the start point. Incompatible with `interiorAbsolute` or `endAbsolute`. | Yes |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should this segment end? Requires `interiorAbsolute`. Incompatible with `interior` or `end`. | No |
| `coefficients` | [[`number`](/docs/kcl-std/types/std-types-number); 3] | The coefficients [a, b, c] of the parabolic equation y = ax^2 + bx + c. Incompatible with `interior`. | No |
| `interior` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point between the segment's start and end that lies on the parabola. Incompatible with `coefficients` or `interiorAbsolute` or `endAbsolute`. | No |
| `interiorAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Any point between the segment's start and end. Requires `endAbsolute`. Incompatible with `coefficients` or `interior` or `end`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this segment. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



