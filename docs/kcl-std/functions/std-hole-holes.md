---
title: "hole::holes"
subtitle: "Function in std::hole"
excerpt: "From the hole's parts (bottom, middle, top), cut the hole into the given solid, at each of the given 2D positions on the given face. Basically like function `hole` but it takes multiple 2D positions in `cutsAt`."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

From the hole's parts (bottom, middle, top), cut the hole into the given solid, at each of the given 2D positions on the given face. Basically like function `hole` but it takes multiple 2D positions in `cutsAt`.

```kcl
hole::holes(
  @solid: Solid,
  face: TaggedFace,
  holeBottom,
  holeBody,
  holeType,
  cutsAt: [[number(Length); 2]],
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Which solid to add a hole to. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Which face of the solid to add the hole to. | Yes |
| `holeBottom` |  | Define bottom feature of the hole. E.g. drilled or flat. | Yes |
| `holeBody` |  | Define the main length of the hole. E.g. a blind distance. | Yes |
| `holeType` |  | Define the top feature of the hole. E.g. countersink, counterbore, simple. | Yes |
| `cutsAt` | `[[number(Length); 2]]` | Where to place the holes on the given solid face. This controls how far up/down/left/right each hole is placed. | Yes |



