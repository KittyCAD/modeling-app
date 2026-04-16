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

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2]` | Two supported line/arc/circle segments that should touch without crossing. | Yes |



