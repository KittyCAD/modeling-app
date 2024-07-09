---
title: "ln"
excerpt: "Computes the natural logarithm of the number."
layout: manual
---

Computes the natural logarithm of the number.



```js
ln(num: number) -> number
```

### Tags

* `math`

### Examples

```js
const exampleSketch = startSketchOn("XZ")
  |> startProfileAt([0, 0], %)
  |> line([ln(100), 15], %)
  |> line([5, -6], %)
  |> line([-10, -10], %)
  |> close(%)

const example = extrude(5, exampleSketch)
```

![Rendered example of ln 0](data:image/png;base64,)

### Arguments

* `num`: `number` (REQUIRED)

### Returns

`number`



