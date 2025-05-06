---
title: "legLen"
excerpt: "Compute the length of the given leg."
layout: manual
---

Compute the length of the given leg.



```kcl
legLen(
  hypotenuse: number,
  leg: number,
): number
```

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `hypotenuse` | [`number`](/docs/kcl-std/types/std-types-number) | The length of the triangle's hypotenuse | Yes |
| `leg` | [`number`](/docs/kcl-std/types/std-types-number) | The length of one of the triangle's legs (i.e. non-hypotenuse side) | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number)


### Examples

```kcl
legLen(hypotenuse = 5, leg = 3)
```



