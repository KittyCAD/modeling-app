---
title: "getBoundedEdge"
subtitle: "Function in std::sketch"
excerpt: "Get a bounded edge of a surface used for the [blend](/docs/kcl-std/functions/std-solid-blend) operation. A bounded edge is a reference to an existing edge that can be clipped at both ends. This will result in only the non-clipped portion of the edge being used during the blend."
layout: manual
---

Get a bounded edge of a surface used for the [blend](/docs/kcl-std/functions/std-solid-blend) operation. A bounded edge is a reference to an existing edge that can be clipped at both ends. This will result in only the non-clipped portion of the edge being used during the blend.

```kcl
getBoundedEdge(
  @solid: Solid,
  edge: TaggedEdge,
  lowerBound?: number(_),
  upperBound?: number(_),
): BoundedEdge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid that the edge belongs to. | Yes |
| `edge` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The tag of the edge that is part of the face | Yes |
| `lowerBound` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A lower percentage bound of the edge, must be between 0 and 1 inclusive. Defaults to 0. | No |
| `upperBound` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A upper percentage bound of the edge, must be between 0 and 1 inclusive. Defaults to 1. | No |

### Returns

[`BoundedEdge`](/docs/kcl-std/types/std-types-BoundedEdge) - A [bounded edge](/docs/kcl-std/functions/std-sketch-getBoundedEdge) of a solid.



