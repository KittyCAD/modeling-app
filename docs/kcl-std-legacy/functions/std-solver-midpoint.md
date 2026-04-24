---
title: "solver::midpoint"
subtitle: "Function in std::solver"
excerpt: "Constrain a point to lie at the midpoint of a line segment or circular arc."
layout: manual
---

Constrain a point to lie at the midpoint of a line segment or circular arc.

```kcl
solver::midpoint(
  @input: Segment,
  point: Segment,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `Segment` | The line or circular arc whose midpoint is constrained. | Yes |
| `point` | `Segment` | The point to place at the midpoint. | Yes |
