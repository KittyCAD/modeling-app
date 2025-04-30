---
title: "std::math::atan"
excerpt: "Compute the arctangent of a number."
layout: manual
---

Compute the arctangent of a number.

Consider using `atan2()` instead for the true inverse of tangent.

```js
atan(@num: number(_)): number(rad)
```


### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | `number(_)` |  | Yes |

### Returns

`number(rad)`


### Examples

```js
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(
    angle = atan(1.25),
    length = 20,
  )
  |> yLine(endAbsolute = 0)
  |> close()

extrude001 = extrude(sketch001, length = 5)
```



