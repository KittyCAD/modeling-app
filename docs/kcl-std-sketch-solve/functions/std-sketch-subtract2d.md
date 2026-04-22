---
title: "subtract2d"
subtitle: "Function in std::sketch"
excerpt: "Use a 2-dimensional sketch to cut a hole in another 2-dimensional sketch."
layout: manual
---

Use a 2-dimensional sketch to cut a hole in another 2-dimensional sketch.

```kcl
subtract2d(
  @sketch: Sketch,
  tool: [Sketch; 1+],
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | `Sketch` | Which sketch should this path be added to? | Yes |
| `tool` | `[Sketch; 1+]` | The shape(s) which should be cut out of the sketch. | Yes |

### Returns

`Sketch` - A sketch is a collection of paths.



