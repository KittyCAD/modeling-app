---
title: "std::sketch::circle"
excerpt: ""
layout: manual
---



Construct a 2-dimensional circle, of the specified radius, centered atthe provided (x, y) origin point.

```js
circle(@sketch_or_surface: Sketch | Plane | Face, center: Point2d, radius: number, tag?: tag): Sketch
```


### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch_or_surface` | [`Sketch`](/docs/kcl/types/Sketch) `|` [`Plane`](/docs/kcl/types/Face) `|` [`Plane`](/docs/kcl/types/Face) |  | Yes |
| `center` | [`Point2d`](/docs/kcl/types/Point2d) |  | Yes |
| `radius` | [`number`](/docs/kcl/types/number) |  | Yes |
| [`tag`](/docs/kcl/types/tag) | [`tag`](/docs/kcl/types/tag) |  | No |

### Returns

[`Sketch`](/docs/kcl/types/Sketch)


### Examples

```js
exampleSketch = startSketchOn(-XZ)
  |> circle( center = [0, 0], radius = 10 )

example = extrude(exampleSketch, length = 5)
```


```js
exampleSketch = startSketchOn(XZ)
  |> startProfileAt([-15, 0], %)
  |> line(end = [30, 0])
  |> line(end = [0, 30])
  |> line(end = [-30, 0])
  |> close()
  |> hole(circle( center = [0, 15], radius = 5), %)

example = extrude(exampleSketch, length = 5)
```



