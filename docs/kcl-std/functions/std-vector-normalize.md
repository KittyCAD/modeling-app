---
title: "vector::normalize"
subtitle: "Function in std::vector"
excerpt: "Normalize a vector (with any number of dimensions)"
layout: manual
---

Normalize a vector (with any number of dimensions)

```kcl
vector::normalize(@v: [number]): [number]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `v` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |

### Returns

[[`number`](/docs/kcl-std/types/std-types-number)]


### Examples

```kcl
v = [3, 4]
normed = vector::normalize(v)
assert(normed[0], isEqualTo = 0.6)
assert(normed[1], isEqualTo = 0.8)

```




