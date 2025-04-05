---
title: "std::math::TAU"
excerpt: "The value of `tau`, the full circle constant (τ). Equal to 2π."
layout: manual
---

The value of `tau`, the full circle constant (τ). Equal to 2π.



```js
std::math::TAU: number = 6.28318530717958647692528676655900577_
```

### Examples

```js
exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> angledLine({
    angle = 50,
    length = 10 * TAU,
  }, %)
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 5)
```

![Rendered example of std::math::TAU 0](data:image/png;base64,)


