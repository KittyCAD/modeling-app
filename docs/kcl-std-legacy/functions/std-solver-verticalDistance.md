---
title: "solver::verticalDistance"
subtitle: "Function in std::solver"
excerpt: "Constrain the vertical distance between two points."
layout: manual
---

Constrain the vertical distance between two points.

```kcl
solver::verticalDistance(@points: [Segment | Point2d; 2])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | `[Segment | Point2d; 2]` | Two sketch points, or one sketch point and `ORIGIN`, whose Y-axis separation should match the value set with `==`. | Yes |



