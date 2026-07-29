---
title: "vector::sub"
subtitle: "Function in std::vector"
excerpt: "Subtracts from every element of u its corresponding element in v. Both vectors must have the same number of elements. Returns a new vector with the same number of elements. In other words, component-wise subtraction."
layout: manual
---

Subtracts from every element of u its corresponding element in v. Both vectors must have the same number of elements. Returns a new vector with the same number of elements. In other words, component-wise subtraction.

```kcl
vector::sub(
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
v2 = vector::sub(u, v)
assert(v2[0], isEqualTo = 9)
assert(v2[1], isEqualTo = 8)
assert(v2[2], isEqualTo = 7)

```




