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

Symmetric `Line`s are at opposite angles (reflected across the axis). Symmetric
`CircularArc`s have equal diameters and centers. Note that the `Symmetric` constraint
does _not_ affect the position (i.e. the start and end points) of Lines or Arcs. To
make their positions symmetric too, add another Symmetric constraint on their start
and endpoints.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2]` | Exactly two points, lines, arcs, or circles of the same kind. | Yes |
| `axis` | `Segment` | The line to mirror across. | Yes |



