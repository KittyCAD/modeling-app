---
title: "faceOf"
subtitle: "Function in std::sketch"
excerpt: "Get the face of a solid."
layout: manual
---

Get the face of a solid.

```kcl
faceOf(
  @solid: Solid,
  face: TaggedFace | Segment,
): Face
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid that has the face. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | Which face of the solid. | Yes |

### Returns

[`Face`](/docs/kcl-std/types/std-types-Face) - A face of a solid.



