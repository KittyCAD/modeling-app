---
title: "xLine"
subtitle: "Function in std::sketch"
excerpt: "Draw a line relative to the current origin to a specified distance away from the current position along the 'x' axis."
layout: manual
---

Draw a line relative to the current origin to a specified distance away from the current position along the 'x' axis.

```kcl
xLine(
  @sketch: Sketch,
  length?: number(Length),
  endAbsolute?: number(Length),
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `length` | `number(Length)` | How far away along the X axis should this line go? Incompatible with `endAbsolute`. | No |
| `endAbsolute` | `number(Length)` | Which absolute X value should this line go to? Incompatible with `length`. | No |
| `tag` | `TagDecl` | Create a new tag which refers to this line. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



