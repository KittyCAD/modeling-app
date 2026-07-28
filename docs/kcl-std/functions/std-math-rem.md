---
title: "rem"
subtitle: "Function in std::math"
excerpt: "Compute the remainder after dividing `num` by `div`. If `num` is negative, the result will be too."
layout: manual
---

Compute the remainder after dividing `num` by `div`. If `num` is negative, the result will be too.

```kcl
rem(
  @num: number,
  divisor: number,
): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | [`number`](/docs/kcl-std/types/std-types-number) | The number which will be divided by `divisor`. | Yes |
| `divisor` | [`number`](/docs/kcl-std/types/std-types-number) | The number which will divide `num`. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
assert(rem(7, divisor = 4), isEqualTo = 3, error = "remainder is 3")
assert(rem(-7, divisor = 4), isEqualTo = -3, error = "remainder is -3")
assert(rem(7, divisor = -4), isEqualTo = 3, error = "remainder is 3")
assert(rem(6, divisor = 2.5), isEqualTo = 1, error = "remainder is 1")
assert(rem(6.5, divisor = 2.5), isEqualTo = 1.5, error = "remainder is 1.5")
assert(rem(6.5, divisor = 2), isEqualTo = 0.5, error = "remainder is 0.5")

```




