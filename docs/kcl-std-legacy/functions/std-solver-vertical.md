---
title: "solver::vertical"
subtitle: "Function in std::solver"
excerpt: "Constrain a line, or a list of points, to be vertical."
layout: manual
---

Constrain a line, or a list of points, to be vertical.

```kcl
solver::vertical(@input: Segment | [Segment | Point2d; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `Segment | [Segment | Point2d; 2+]` | Either - A single line segment that should remain vertical. - A list of points which should all be vertical. | Yes |



