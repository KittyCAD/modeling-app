---
title: "edgeId"
subtitle: "Function in std"
excerpt: "Given a edge index, find its ID."
layout: manual
---

Given a edge index, find its ID.

```kcl
edgeId(
  @body: Solid,
  index: number(_),
): Edge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose edges we're trying to find | Yes |
| `index` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Edge to identify. The index is a stable ordering of edges, used when you can't get the usual ID (UUID) of a edge. | Yes |

### Returns

[`Edge`](/docs/kcl-std/types/std-types-Edge) - An edge of a solid.



