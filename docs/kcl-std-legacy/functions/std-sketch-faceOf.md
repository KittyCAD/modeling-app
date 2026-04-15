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
| `solid` | `Solid` | The solid that has the face. | Yes |
| `face` | `TaggedFace | Segment` | Which face of the solid. | Yes |

### Returns

`Face` - A face of a solid.



