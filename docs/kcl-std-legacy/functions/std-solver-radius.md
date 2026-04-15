---
title: "solver::radius"
subtitle: "Function in std::solver"
excerpt: "Constrain the radius of an arc segment. Accepts a single arc segment and constrains the distance from its center to its start point."
layout: manual
---

Constrain the radius of an arc segment. Accepts a single arc segment and constrains the distance from its center to its start point.

```kcl
solver::radius(@points: Segment)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The arc segment whose radius should match the value set with `==`. | Yes |



