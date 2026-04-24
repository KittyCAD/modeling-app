---
title: "solver::midpoint"
subtitle: "Function in std::solver"
excerpt: "Constrain a point to lie at the midpoint of a line segment."
layout: manual
---

Constrain a point to lie at the midpoint of a line segment.

```kcl
solver::midpoint(
  @input: Segment,
  line: Segment,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `Segment` | The point to place at the midpoint. | Yes |
| `line` | `Segment` | The line whose midpoint is constrained. | Yes |



