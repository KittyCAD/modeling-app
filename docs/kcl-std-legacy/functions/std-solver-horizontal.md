---
title: "solver::horizontal"
subtitle: "Function in std::solver"
excerpt: "Constrain a line, or a list of points, to be horizontal."
layout: manual
---

Constrain a line, or a list of points, to be horizontal.

```kcl
solver::horizontal(@input: Segment | [Segment | Point2d; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `Segment | [Segment | Point2d; 2+]` | Either - A single line segment that should remain horizontal. - A list of points which should all be horizontal. | Yes |



