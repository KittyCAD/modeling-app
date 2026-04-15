---
title: "edgeId"
subtitle: "Function in std"
excerpt: "Given an edge index, find its ID. In general, you should prefer tagging edges to using this function. Use this function if you can't tag an edge. For example, if the edge comes from imported geometry in a .STEP file, or if it's from an operation that doesn't yet support tagging the edges it creates, like `subtract`."
layout: manual
---

Given an edge index, find its ID. In general, you should prefer tagging edges to using this function. Use this function if you can't tag an edge. For example, if the edge comes from imported geometry in a .STEP file, or if it's from an operation that doesn't yet support tagging the edges it creates, like `subtract`.

```kcl
edgeId(
  @body: Solid,
  index?: number(_),
  closestTo?: Point3d,
): Edge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | `Solid` | The solid whose edges we're trying to find | Yes |
| `index` | `number(_)` | Edge to identify. The index is a stable ordering of edges, used when you can't get the usual ID of an edge. | No |
| `closestTo` | `Point3d` | Query the edge closest to this point. Uses absolute global coordinates. | No |

### Returns

`Edge` - An edge of a solid.



