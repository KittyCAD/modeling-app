---
title: "faceId"
subtitle: "Function in std"
excerpt: "Given a face index, find its ID."
layout: manual
---

Given a face index, find its ID.

```kcl
faceId(
  @body: Solid,
  index: number(_),
): TaggedFace
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose faces we're trying to find | Yes |
| `index` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Face to identify. The index is a stable ordering of faces, used when you can't get the usual ID (UUID) of a face. | Yes |

### Returns

[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) - A tag which references a face of a solid, including the distinguished tags `START` and `END`.



