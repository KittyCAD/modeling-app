---
title: "vector::dot"
subtitle: "Function in std::vector"
excerpt: "Find the dot product of two points or vectors of any dimension."
layout: manual
---

Find the dot product of two points or vectors of any dimension.

```kcl
vector::dot(
  @u: [number],
  v: [number],
): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `u` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |
| `v` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
u = [1, 2, 3]
v = [4, -5, 6]
dotprod = vector::dot(u, v)
assert(dotprod, isEqualTo = 12)

```




