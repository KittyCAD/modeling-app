---
title: "line"
subtitle: "Function in std::sketch"
excerpt: "Extend the current sketch with a new straight line."
layout: manual
---

Extend the current sketch with a new straight line.

```kcl
line(
  @sketch: Sketch,
  endAbsolute?: Point2d,
  end?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Which absolute point should this line go to? Incompatible with `end`. | No |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | How far away (along the X and Y axes) should this line go? Incompatible with `endAbsolute`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



