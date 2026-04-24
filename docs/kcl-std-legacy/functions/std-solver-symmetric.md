---
title: "solver::symmetric"
subtitle: "Function in std::solver"
excerpt: "Constrain two points, lines, arcs, or circles to be symmetric across an axis line."
layout: manual
---

Constrain two points, lines, arcs, or circles to be symmetric across an axis line.

```kcl
solver::symmetric(
  @input: [Segment; 2],
  axis: Segment,
)
```

Supported homogeneous input pairs:
- `Point` / `Point`
- `Line` / `Line`
- `CircularArc` / `CircularArc`
- `Circle` / `Circle`

For circular geometry, symmetry constrains the underlying circles:
mirrored centers plus a shared radius/diameter. Arc end points are not mirrored.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2]` | Exactly two points, lines, arcs, or circles of the same kind. | Yes |
| `axis` | `Segment` | The line to mirror across. | Yes |



