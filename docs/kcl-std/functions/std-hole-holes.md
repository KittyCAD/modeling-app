---
title: "hole::holes"
subtitle: "Function in std::hole"
excerpt: "From the hole's parts (bottom, middle, top), cut the hole into the given solid, at each of the given 2D positions on the given face. Basically like function `hole` but it takes multiple 2D positions in `cutsAt`."
layout: manual
---

From the hole's parts (bottom, middle, top), cut the hole into the given solid, at each of the given 2D positions on the given face. Basically like function `hole` but it takes multiple 2D positions in `cutsAt`.

```kcl
hole::holes(
  @solid,
  face,
  holeBottom,
  holeBody,
  holeType,
  cutsAt,
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
| `cutsAt` |  |  | Yes |



