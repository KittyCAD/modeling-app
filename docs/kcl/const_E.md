---
title: "E"
excerpt: "The value of Euler’s number `e`."
layout: manual
---

The value of Euler’s number `e`.



```js
E: number = 2.71828182845904523536028747135266250_
```

### Examples

```js
exampleSketch = startSketchOn("XZ")
  |> startProfileAt([0, 0], %)
  |> angledLine({
    angle = 30,
    length = 2 * E ^ 2,
  }, %)
  |> yLineTo(0, %)
  |> close(%)

example = extrude(10, exampleSketch)
```

![Rendered example of E 0](data:image/png;base64,)


