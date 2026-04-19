---
title: "isSurface"
subtitle: "Function in std::solid"
excerpt: "Given a KCL value that is a 'body' (currently typed as `Solid`), returns `true` if the value is a surface and `false` otherwise."
layout: manual
---

Given a KCL value that is a 'body' (currently typed as `Solid`), returns `true` if the value is a surface and `false` otherwise.

```kcl
isSurface(@val: Solid): bool
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `val` | `Solid` | Value to check if it is a surface or not | Yes |

### Returns

`bool` - A boolean value.



