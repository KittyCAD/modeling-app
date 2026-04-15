---
title: "solver::diameter"
subtitle: "Function in std::solver"
excerpt: "Constrain the diameter of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point. Note: Diameter uses the same solver constraint as radius (distance between two points), but is stored as a separate constraint type for proper UI display."
layout: manual
---

Constrain the diameter of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point. Note: Diameter uses the same solver constraint as radius (distance between two points), but is stored as a separate constraint type for proper UI display.

```kcl
solver::diameter(@points: Segment)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The arc or circle segment whose diameter should match the value set with `==`. | Yes |



