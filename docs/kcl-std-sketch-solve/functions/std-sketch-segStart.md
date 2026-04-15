---
title: "segStart"
subtitle: "Function in std::sketch"
excerpt: "Compute the starting point of the provided line segment."
layout: manual
---

Compute the starting point of the provided line segment.

```kcl
segStart(@tag: TaggedEdge): Point2d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The line segment being queried by its tag. | Yes |

### Returns

[`Point2d`](/docs/kcl-std/types/std-types-Point2d) - A point in two dimensional space.



