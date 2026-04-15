---
title: "getCommonEdge"
subtitle: "Function in std::sketch"
excerpt: "Get the shared edge between two faces."
layout: manual
---

Get the shared edge between two faces.

```kcl
getCommonEdge(faces: [TaggedFace; 2]): Edge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `faces` | `[TaggedFace; 2]` | The tags of the faces you want to find the common edge between. | Yes |

### Returns

`Edge` - An edge of a solid.



