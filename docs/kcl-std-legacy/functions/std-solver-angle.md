---
title: "solver::angle"
subtitle: "Function in std::solver"
excerpt: "Constrain lines to meet at a given angle."
layout: manual
---

Constrain lines to meet at a given angle.

```kcl
solver::angle(
  @input: [Segment; 2],
  labelPosition?: Point2d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2]` | The two line segments whose relative angle should match the value set with `==`. | Yes |
| `labelPosition` | `Point2d` | Optional position for the displayed constraint label in the sketch's local 2D coordinate system. | No |



