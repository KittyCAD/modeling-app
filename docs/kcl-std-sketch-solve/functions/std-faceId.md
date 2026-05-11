---
title: "faceId"
subtitle: "Function in std"
excerpt: "Given a face index, find its ID. In general, you should prefer tagging faces to using this function. Use this function if you can't tag a face. For example, if the face comes from imported geometry in a .STEP file, or if it's from an operation that doesn't yet support tagging the faces it creates, like `subtract`."
layout: manual
---

Given a face index, find its ID. In general, you should prefer tagging faces to using this function. Use this function if you can't tag a face. For example, if the face comes from imported geometry in a .STEP file, or if it's from an operation that doesn't yet support tagging the faces it creates, like `subtract`.

```kcl
faceId(
  @body: Solid,
  index: number(_),
): TaggedFace
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | `Solid` | The solid whose faces we're trying to find | Yes |
| `index` | `number(_)` | Face to identify. The index is a stable ordering of faces, used when you can't get the usual ID of a face. | Yes |

### Returns

`TaggedFace` - A tag which references a face of a solid, including the distinguished tags `START` and `END`.



