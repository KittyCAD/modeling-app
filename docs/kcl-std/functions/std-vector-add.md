---
title: "vector::add"
subtitle: "Function in std::vector"
excerpt: "Adds every element of u to its corresponding element in v. Both vectors must have the same number of elements. Returns a new vector with the same number of elements. In other words, component-wise addition."
layout: manual
---

Adds every element of u to its corresponding element in v. Both vectors must have the same number of elements. Returns a new vector with the same number of elements. In other words, component-wise addition.

```kcl
vector::add(
  @u: [number],
  v: [number],
): [number]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `u` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |
| `v` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |

### Returns

[[`number`](/docs/kcl-std/types/std-types-number)]


### Examples

```kcl
u = [1, 2, 3]
v = [10, 10, 10]
v2 = vector::add(u, v)
assert(v2[0], isEqualTo = 11)
assert(v2[1], isEqualTo = 12)
assert(v2[2], isEqualTo = 13)

```




