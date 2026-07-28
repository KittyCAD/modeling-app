---
title: "vector::magnitude"
subtitle: "Function in std::vector"
excerpt: "Find the Euclidean distance of a vector."
layout: manual
---

Find the Euclidean distance of a vector.

```kcl
vector::magnitude(@v: [number]): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `v` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
v = [3, 4]
m = vector::magnitude(v)
assert(m, isEqualTo = 5)

```




