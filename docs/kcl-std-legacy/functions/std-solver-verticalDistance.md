---
title: "solver::verticalDistance"
subtitle: "Function in std::solver"
excerpt: "Constrain the vertical distance between two points."
layout: manual
---

Constrain the vertical distance between two points.

```kcl
solver::verticalDistance(
  @points: [Segment | Point2d; 2],
  labelPosition?: Point2d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | `[Segment | Point2d; 2]` | Two sketch points, or one sketch point and `ORIGIN`, whose Y-axis separation should match the value set with `==`. | Yes |
| `labelPosition` | `Point2d` | Optional position for the displayed constraint label in the sketch's local 2D coordinate system. | No |



