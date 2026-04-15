---
title: "PI"
subtitle: "Constant in std::math"
excerpt: "The value of `pi`, Archimedes’ constant (π)."
layout: manual
---

The value of `pi`, Archimedes’ constant (π).

```kcl
PI: number(_?) = 3.14159265358979323846264338327950288_?
```

`PI` is a number and is technically a ratio, so you might expect it to have type [`number(_)`](/docs/kcl-std/types/std-types-number).
However, `PI` is nearly always used for converting between different units - usually degrees to or
from radians. Therefore, `PI` is treated a bit specially by KCL and always has unknown units. This
means that if you use `PI`, you will need to give KCL some extra information about the units of numbers.
Usually you should use type ascription on the result of calculations, e.g., `(2 * PI): rad`.
It is better to use `units::toRadians` or `units::toDegrees` to convert between angles with
different units where possible.

### Type

[`number(_?)`](/docs/kcl-std/types/std-types-number) - A number.

### Examples

```kcl
circumference = 70

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = (circumference / (2 * PI)): mm)

example = extrude(exampleSketch, length = 5)

```

![Rendered example of PI 0](/kcl-test-outputs/serial_test_example_const_std-math-PI0.png)


