---
title: "solver::tangent"
subtitle: "Function in std::solver"
excerpt: "Constrain two segments to be tangent."
layout: manual
---

Constrain two segments to be tangent.

```kcl
solver::tangent(@input: [Segment; 2])
```

Supported input type pairs (unordered):
- `Line` / `Circle`
- `Line` / `CircularArc`
- `Circle` / `Circle`
- `Circle` / `CircularArc`
- `CircularArc` / `CircularArc`
- `controlPointSpline` / `Line`
- `controlPointSpline` / `Circle`
- `controlPointSpline` / `CircularArc`

For `controlPointSpline`, tangent is solved against the spline itself, not just the
first or last control-polygon edge. The solver introduces a hidden spline parameter
and finds the tangent point along the curve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2]` | Two supported line/arc/circle segments that should touch without crossing. | Yes |



