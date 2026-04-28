---
title: "solver::coincident"
subtitle: "Function in std::solver"
excerpt: "Constrain points, or a point and a segment to be coincident."
layout: manual
---

Constrain points, or a point and a segment to be coincident.

```kcl
solver::coincident(@points: [Segment | Point2d; 2+])
```

Supports two points, or one point and one segment (line/arc).
A single `Point2d` (e.g. `[1mm, 2.5mm]`) can be used to pin a point to a fixed position.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | `[Segment | Point2d; 2+]` | Two or more sketch entities that should be coincident. When more than two inputs are provided, each item must be a point or `ORIGIN`. | Yes |



