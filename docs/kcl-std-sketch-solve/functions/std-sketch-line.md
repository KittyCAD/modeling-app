---
title: "line"
subtitle: "Function in std::sketch"
excerpt: "Extend the current sketch with a new straight line."
layout: manual
---

**WARNING:** This function is deprecated as of KCL 2.0.

Extend the current sketch with a new straight line.

```kcl
line(
  @sketch: Sketch,
  endAbsolute?: Point2d,
  end?: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is deprecated in favor of
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `endAbsolute` | `Point2d` | Which absolute point should this line go to? Incompatible with `end`. | No |
| `end` | `Point2d` | How far away (along the X and Y axes) should this line go? Incompatible with `endAbsolute`. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this line. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



