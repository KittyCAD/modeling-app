---
title: "flipSurface"
subtitle: "Function in std::solid"
excerpt: "Flips the orientation of a surface, swapping which side is the front and which is the reverse."
layout: manual
---

Flips the orientation of a surface, swapping which side is the front and which is the reverse.

```kcl
flipSurface(@surface: [Solid; 1+]): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `surface` | `[Solid; 1+]` | The surfaces to flip (swap the surface's back and front sides) | Yes |

### Returns

`[Solid; 1+]`



