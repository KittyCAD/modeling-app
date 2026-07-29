---
title: "vector::mul"
subtitle: "Function in std::vector"
excerpt: "Multiplies every element of u by its corresponding element in v. Both vectors must have the same number of elements. Returns a new vector with the same number of elements. In other words, component-wise multiplication."
layout: manual
---

Multiplies every element of u by its corresponding element in v. Both vectors must have the same number of elements. Returns a new vector with the same number of elements. In other words, component-wise multiplication.

```kcl
vector::mul(
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
u = [10, 10, 10]
v = [1, 2, 3]
v2 = vector::mul(u, v)
assert(v2[0], isEqualTo = 10)
assert(v2[1], isEqualTo = 20)
assert(v2[2], isEqualTo = 30)

```




