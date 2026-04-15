---
title: "solver::distance"
subtitle: "Function in std::solver"
excerpt: "Constrain the distance between two points."
layout: manual
---

Constrain the distance between two points.

```kcl
solver::distance(@points: [Segment | Point2d; 2])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [[`Segment`](/docs/kcl-std/types/std-types-Segment) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d); 2] | Two sketch points, or one sketch point and `ORIGIN`, whose separation should match the value set with `==`. | Yes |



