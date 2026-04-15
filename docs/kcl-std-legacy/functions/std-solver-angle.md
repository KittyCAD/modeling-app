---
title: "solver::angle"
subtitle: "Function in std::solver"
excerpt: "Constrain lines to meet at a given angle."
layout: manual
---

Constrain lines to meet at a given angle.

```kcl
solver::angle(@input: [Segment; 2])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2]` | The two line segments whose relative angle should match the value set with `==`. | Yes |



