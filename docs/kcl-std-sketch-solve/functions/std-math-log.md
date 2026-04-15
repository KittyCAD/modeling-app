---
title: "log"
subtitle: "Function in std::math"
excerpt: "Compute the logarithm of the number with respect to an arbitrary base."
layout: manual
---

Compute the logarithm of the number with respect to an arbitrary base.

```kcl
log(
  @input: number,
  base: number(_),
): number
```

The result might not be correctly rounded owing to implementation
details; `log2` can produce more accurate results for base 2,
and `log10` can produce more accurate results for base 10.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`number`](/docs/kcl-std/types/std-types-number) | The number to compute the logarithm of. | Yes |
| `base` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The base of the logarithm. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.



