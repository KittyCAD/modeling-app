---
title: "hole::holeGeometry"
subtitle: "Function in std::hole"
excerpt: "Build a hole's geometry from its top, bottom and depth. Can be subtracted from a solid to cut a hole into it."
layout: manual
---

Build a hole's geometry from its top, bottom and depth. Can be subtracted from a solid to cut a hole into it.

```kcl
hole::holeGeometry(
  @solid,
  face,
  holeBottom,
  holeBody,
  holeType,
  cutAt,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` |  |  | Yes |
| `face` |  |  | Yes |
| `holeBottom` |  |  | Yes |
| `holeBody` |  |  | Yes |
| `holeType` |  |  | Yes |
| `cutAt` |  |  | Yes |



