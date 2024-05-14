---
title: "abs"
excerpt: "Computes the absolute value of a number."
layout: manual
---

Computes the absolute value of a number.



```js
abs(num: number) -> number
```

### Tags

* `math`

### Examples

```js
const myAngle = -120

const sketch001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> line([8, 0], %)
  |> angledLine({ angle: abs(myAngle), length: 5 }, %)
  |> line([-5, 0], %)
  |> angledLine({ angle: myAngle, length: 5 }, %)
  |> close(%)

const baseExtrusion = extrude(5, sketch001)
```

### Arguments

* `num`: `number` (REQUIRED)

### Returns

`number`



