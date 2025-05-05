---
title: "legAngY"
excerpt: "Compute the angle of the given leg for y."
layout: manual
---

Compute the angle of the given leg for y.



```kcl
legAngY(
  hypotenuse: number,
  leg: number,
): number
```

### Tags

* `utilities`


### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `hypotenuse` | [`number`](/docs/kcl-std/types/std-types-number) | The length of the triangle's hypotenuse | Yes |
| `leg` | [`number`](/docs/kcl-std/types/std-types-number) | The length of one of the triangle's legs (i.e. non-hypotenuse side) | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number)


### Examples

```kcl
legAngY(hypotenuse = 5, leg = 3)
```


