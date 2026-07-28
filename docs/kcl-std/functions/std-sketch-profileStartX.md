---
title: "profileStartX"
subtitle: "Function in std::sketch"
excerpt: "Extract the provided 2-dimensional sketch's profile's origin's 'x' value."
layout: manual
---

Extract the provided 2-dimensional sketch's profile's origin's 'x' value.

```kcl
profileStartX(@profile: Sketch): number(Length)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `profile` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Profile whose start is being used. | Yes |

### Returns

[`number(Length)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
sketch001 = startSketchOn(XY)
  |> startProfile(at = [5, 2])
  |> angledLine(angle = -26.6deg, length = 50)
  |> angledLine(angle = 90deg, length = 50)
  |> angledLine(angle = 30deg, endAbsoluteX = profileStartX(%))

```


![Rendered example of profileStartX 0](/kcl-test-outputs/serial_test_example_fn_std-sketch-profileStartX0.png)


