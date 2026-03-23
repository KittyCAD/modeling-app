---
title: "E"
subtitle: "Constant in std::math"
excerpt: "The value of Euler’s number `e`."
layout: manual
---

The value of Euler’s number `e`.

```kcl
E: number = 2.71828182845904523536028747135266250_
```



### Type

[`number`](/docs/kcl-std/types/std-types-number) - A number.

### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 30deg, length = 2 * E ^ 2)
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 10)

```

![Rendered example of E 0](/kcl-test-outputs/serial_test_example_const_std-math-E0.png)


