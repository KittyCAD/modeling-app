---
title: "angledLineThatIntersects"
subtitle: "Function in std::sketch"
excerpt: "Draw an angled line from the current origin, constructing a line segment such that the newly created line intersects the desired target line segment."
layout: manual
---

Draw an angled line from the current origin, constructing a line segment such that the newly created line intersects the desired target line segment.

```kcl
angledLineThatIntersects(
  @sketch: Sketch,
  angle: number(Angle),
  intersectTag: TaggedEdge,
  offset?: number(Length),
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Which angle should the line be drawn at? | Yes |
| `intersectTag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The tag of the line to intersect with. | Yes |
| `offset` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The offset from the intersecting line. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



