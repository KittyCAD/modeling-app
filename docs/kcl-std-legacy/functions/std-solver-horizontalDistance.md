---
title: "solver::horizontalDistance"
subtitle: "Function in std::solver"
excerpt: "Constrain the horizontal distance between two points."
layout: manual
---

Constrain the horizontal distance between two points.

```kcl
solver::horizontalDistance(@points: [Segment | Point2d; 2])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | `[Segment | Point2d; 2]` | Two sketch points, or one sketch point and `ORIGIN`, whose X-axis separation should match the value set with `==`. | Yes |



