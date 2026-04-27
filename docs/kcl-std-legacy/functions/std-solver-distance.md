---
title: "solver::distance"
subtitle: "Function in std::solver"
excerpt: "Constrain the distance between two points."
layout: manual
---

Constrain the distance between two points.

```kcl
solver::distance(
  @points: [Segment | Point2d; 2],
  label?: Point2d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | `[Segment | Point2d; 2]` | Two sketch points, or one sketch point and `ORIGIN`, whose separation should match the value set with `==`. | Yes |
| `label` | `Point2d` | Optional position for the displayed constraint label in the sketch's local 2D coordinate system. | No |



