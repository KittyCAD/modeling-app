---
title: "std::math::cos"
excerpt: "Compute the cosine of a number (in radians)."
layout: manual
---

Compute the cosine of a number (in radians).



```js
cos(num: number(rad)): number(_)
```


### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | `number(rad)` |  | Yes |

### Returns

`number(_)`


### Examples

```js
exampleSketch = startSketchOn("XZ")
  |> startProfileAt([0, 0], %)
  |> angledLine({
    angle = 30,
    length = 3 / cos(toRadians(30)),
  }, %)
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 5)
```



