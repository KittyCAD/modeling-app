---
title: "close"
subtitle: "Function in std::sketch"
excerpt: "Construct a line segment from the current origin back to the profile's origin, ensuring the resulting 2-dimensional sketch is not open-ended."
layout: manual
---

Construct a line segment from the current origin back to the profile's origin, ensuring the resulting 2-dimensional sketch is not open-ended.

```kcl
close(
  @sketch: Sketch,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver).

If you want to perform some 3-dimensional operation on a sketch, like
extrude or sweep, you must `close` it first. `close` must be called even
if the end point of the last segment is coincident with the sketch
starting point.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | The sketch you want to close. | Yes |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



