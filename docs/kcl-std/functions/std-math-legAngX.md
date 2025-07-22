---
title: "legAngX"
subtitle: "Function in std::math"
excerpt: "Compute the angle of the given leg for x."
layout: manual
---

Compute the angle of the given leg for x.

```kcl
legAngX(
  hypotenuse: number(Length),
  leg: number(Length),
): number(deg)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `hypotenuse` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The length of the triangle's hypotenuse. | Yes |
| `leg` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The length of one of the triangle's legs (i.e. non-hypotenuse side). | Yes |

### Returns

[`number(deg)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
legAngX(hypotenuse = 5, leg = 3)

```



