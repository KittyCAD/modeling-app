---
title: "legLen"
subtitle: "Function in std::math"
excerpt: "Compute the length of the given leg."
layout: manual
---

Compute the length of the given leg.

```kcl
legLen(
  hypotenuse: number(Length),
  leg: number(Length),
): number(Length)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `hypotenuse` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The length of the triangle's hypotenuse. | Yes |
| `leg` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The length of one of the triangle's legs (i.e. non-hypotenuse side). | Yes |

### Returns

[`number(Length)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
legLen(hypotenuse = 5, leg = 3)

```




