---
title: "yLine"
subtitle: "Function in std::sketch"
excerpt: "Draw a line relative to the current origin to a specified distance away from the current position along the 'y' axis."
layout: manual
---

Draw a line relative to the current origin to a specified distance away from the current position along the 'y' axis.

```kcl
yLine(
  @sketch: Sketch,
  length?: number(Length),
  endAbsolute?: number(Length),
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | How far away along the Y axis should this line go? Incompatible with `endAbsolute`. | No |
| `endAbsolute` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Which absolute Y value should this line go to? Incompatible with `length`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



