---
title: "getBoundedEdge"
subtitle: "Function in std::sketch"
excerpt: "Get a bounded edge of a surface used for the blend operation. A bounded edge is a reference to an existing edge that can be clipped at both ends. This will result in only the non-clipped portion of the edge being used during the blend."
layout: manual
---

Get a bounded edge of a surface used for the blend operation. A bounded edge is a reference to an existing edge that can be clipped at both ends. This will result in only the non-clipped portion of the edge being used during the blend.

```kcl
getBoundedEdge(
  @solid: Solid,
  edge: Edge,
  lowerBound?: number(_),
  upperBound?: number(_),
): BoundedEdge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | `Solid` | The solid that the edge belongs to. | Yes |
| `edge` | `Edge` | The edge to bound. This can be a tagged edge or an edge ID from `edgeId(...)`. | Yes |
| `lowerBound` | `number(_)` | A lower percentage bound of the edge, must be between 0 and 1 inclusive. Defaults to 0. | No |
| `upperBound` | `number(_)` | A upper percentage bound of the edge, must be between 0 and 1 inclusive. Defaults to 1. | No |

### Returns

`BoundedEdge` - A bounded edge of a solid.



