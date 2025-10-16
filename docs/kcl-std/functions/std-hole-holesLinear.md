---
title: "hole::holesLinear"
subtitle: "Function in std::hole"
excerpt: "Place the given holes in a line. Basically like function `hole` but cuts multiple holes in a line. Works like linear patterns."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Place the given holes in a line. Basically like function `hole` but cuts multiple holes in a line. Works like linear patterns.

```kcl
hole::holesLinear(
  @solid: Solid,
  face: TaggedFace,
  holeBottom,
  holeBody,
  holeType,
  cutAt: [number(Length); 2],
  instances: number(_),
  distance,
  axis: Axis2d | Point2d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Which solid to add a hole to. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Which face of the solid to add the hole to. Controls the orientation of the hole. | Yes |
| `holeBottom` |  | Define bottom feature of the hole. E.g. drilled or flat. | Yes |
| `holeBody` |  | Define the main length of the hole. E.g. a blind distance. | Yes |
| `holeType` |  | Define the top feature of the hole. E.g. countersink, counterbore, simple. | Yes |
| `cutAt` | [`[number(Length); 2]`](/docs/kcl-std/types/std-types-number) | Where to place the first cut in the linear pattern, given as absolute coordinates in the global scene. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | How many holes to cut. | Yes |
| `distance` |  | How far between each hole | Yes |
| `axis` | [`Axis2d`](/docs/kcl-std/types/std-types-Axis2d) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Along which axis should the holes be cut? | Yes |



