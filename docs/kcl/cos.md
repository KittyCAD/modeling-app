---
title: "cos"
excerpt: "Compute the cosine of a number (in radians)."
layout: manual
---

Compute the cosine of a number (in radians).



```js
cos(num: number): number
```


### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | `number` |  | Yes |

### Returns

`number` 


### Examples

```js
exampleSketch = startSketchOn("XZ")
  |> startProfileAt([0, 0], %)
  |> angledLine({
    angle = 30,
    length = 3 / cos(toRadians(30)),
  }, %)
  |> yLineTo(0, %)
  |> close(%)

example = extrude(5, exampleSketch)
```

![Rendered example of cos 0](data:image/png;base64,)


