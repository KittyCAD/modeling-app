---
title: "getBoundedEdge"
subtitle: "Function in std::sketch"
excerpt: "Get a bounded edge of a surface."
layout: manual
---

Get a bounded edge of a surface.

```kcl
getBoundedEdge(
  @solid: Solid,
  edge: TaggedEdge,
  lowerBound?: number,
  upperBound?: number,
): BoundedEdge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid that the edge belongs to. | Yes |
| `edge` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The tag of the edge that is part of the face | Yes |
| `lowerBound` | [`number`](/docs/kcl-std/types/std-types-number) | A lower percentage bound of the edge, must be between (0, 1). Defaults to 0. | No |
| `upperBound` | [`number`](/docs/kcl-std/types/std-types-number) | A upper percentage bound of the edge, must be between (0, 1). Defaults to 1. | No |

### Returns

[`BoundedEdge`](/docs/kcl-std/types/std-types-BoundedEdge) - A bounded edge of a solid.



