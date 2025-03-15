---
title: "std::math::sin"
excerpt: "Compute the sine of a number (in radians)."
layout: manual
---

Compute the sine of a number (in radians).



```js
sin(num: number(rad)): number(_)
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
    angle = 50,
    length = 15 / sin(toDegrees(135)),
  }, %)
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 5)
```



